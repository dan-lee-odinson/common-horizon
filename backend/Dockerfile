# Common Horizon backend: runs locally with Docker and on AWS Lambda via the
# Lambda Web Adapter (the same image, unchanged).
#
#   docker build -t common-horizon-backend backend/
#   docker run --rm -p 8080:8080 common-horizon-backend
#
# On Lambda the adapter extension proxies invocations to uvicorn on $AWS_LWA_PORT and
# waits for AWS_LWA_READINESS_CHECK_PATH to return 200 before serving traffic.
#
# Reproducible build: both images are pinned by their multi-arch index digest (linux/amd64 and
# linux/arm64); the tags are for humans. To update, resolve the new digests, rebuild, rerun the
# tests, pip-audit and the smoke test:
#   docker buildx imagetools inspect python:3.12-slim
#   docker buildx imagetools inspect public.ecr.aws/awsguru/aws-lambda-adapter:<version>

# Python 3.12.16, Debian 13 (trixie) slim; index digest resolved 2026-11-14.
FROM python:3.12.16-slim-trixie@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b

# AWS Lambda Web Adapter 1.1.0 (2026-09-18); index digest resolved 2026-11-14.
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0@sha256:17cfd08eff1dfea3f6a9a1e9c65fdac80aa4919b6085e746615530f43f57d2f1 /lambda-adapter /opt/extensions/lambda-adapter

# The base image bundles pip 25.0.1, which has known advisories; it is replaced by a fixed,
# pinned release before anything is installed.
ARG PIP_VERSION=26.3

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_ROOT_USER_ACTION=ignore \
    AWS_LWA_PORT=8080 \
    AWS_LWA_READINESS_CHECK_PATH=/health \
    CH_PHYSICS_ENGINE=synthetic

WORKDIR /var/task

# requirements.txt pins the complete dependency set; --no-deps + pip check fail the build if a pin is
# missing or inconsistent instead of silently resolving an unpinned version.
COPY requirements.txt .
RUN python -m pip install "pip==${PIP_VERSION}" \
    && python -m pip install --no-deps -r requirements.txt \
    && python -m pip check \
    && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app

COPY app ./app

# Unprivileged user for local/container runs (Lambda always runs functions as its own non-root user).
USER 10001

EXPOSE 8080

# Shell form so $AWS_LWA_PORT is expanded; exec keeps uvicorn as PID 1 for clean shutdown.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${AWS_LWA_PORT}"]
