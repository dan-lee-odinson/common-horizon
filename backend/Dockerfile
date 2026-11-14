# Common Horizon backend: runs locally with Docker and on AWS Lambda via the
# Lambda Web Adapter (the same image, unchanged).
#
#   docker build -t common-horizon-backend backend/
#   docker run --rm -p 8080:8080 common-horizon-backend
#
# On Lambda the adapter extension proxies invocations to uvicorn on $PORT and
# waits for AWS_LWA_READINESS_CHECK_PATH to return 200 before serving traffic.
FROM python:3.12-slim

COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080 \
    AWS_LWA_READINESS_CHECK_PATH=/health \
    CH_PHYSICS_ENGINE=synthetic

WORKDIR /var/task

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app

EXPOSE 8080

# Shell form so $PORT is expanded; exec keeps uvicorn as PID 1 for clean shutdown.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
