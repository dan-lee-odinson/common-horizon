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
    CH_PHYSICS_ENGINE=synthetic \
    CH_SPICE_KERNEL_DIR=/opt/common-horizon/spice \
    CH_HORIZON_PROFILE_DIR=/var/task/data/horizon

# The real engine's data. CH_PHYSICS_ENGINE stays "synthetic" above: switching production to
# "physics" is a separate, explicitly authorised configuration change (a Lambda environment variable).
#
# NASA/JPL NAIF SPICE kernels, downloaded from the official NAIF server at build time and verified
# against pinned SHA-256 checksums (the build fails on any mismatch). They are never committed.
# Sizes: 5 257 / 32 726 016 / 12 863 488 / 19 478 bytes. Lowercase names, as kernel_loader expects.
# --chmod: files downloaded by ADD are 0600 by default; Lambda runs as a different non-root user.
# The folder is created first (0755): a folder that ADD creates itself would get the 0444 file mode
# and could not be entered by a non-root user.
ARG NAIF=https://naif.jpl.nasa.gov/pub/naif/generic_kernels
RUN install -d -m 0755 /opt/common-horizon /opt/common-horizon/spice
ADD --chmod=0444 --checksum=sha256:678e32bdb5a744117a467cd9601cd6b373f0e9bc9bbde1371d5eee39600a039b \
    ${NAIF}/lsk/naif0012.tls /opt/common-horizon/spice/naif0012.tls
ADD --chmod=0444 --checksum=sha256:c1c7feeab882263fc493a9d5a5b2ddd71b54826cdf65d8d17a76126b260a49f2 \
    ${NAIF}/spk/planets/de440s.bsp /opt/common-horizon/spice/de440s.bsp
ADD --chmod=0444 --checksum=sha256:60cd55aa401ea2ea97360636f567554bfe4e37bb829f901b4460a455dfaf783f \
    ${NAIF}/pck/moon_pa_de440_200625.bpc /opt/common-horizon/spice/moon_pa_de440_200625.bpc
ADD --chmod=0444 --checksum=sha256:a47c71e9c9f33796bdafb2c9d69a7ee447b6016ecad80f71cd6f3e479f9cf768 \
    ${NAIF}/fk/satellites/moon_de440_250416.tf /opt/common-horizon/spice/moon_de440_250416.tf

WORKDIR /var/task

# requirements.txt pins the complete dependency set; --no-deps + pip check fail the build if a pin is
# missing or inconsistent instead of silently resolving an unpinned version.
COPY requirements.txt .
# rasterio's wheel bundles GDAL but links against the system expat library, which the slim base image
# lacks ("libexpat.so.1: cannot open shared object file"); the import check below fails the build if
# a native library is still missing.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libexpat1 \
    && rm -rf /var/lib/apt/lists/* \
    && python -m pip install "pip==${PIP_VERSION}" \
    && python -m pip install --no-deps -r requirements.txt \
    && python -m pip check \
    && python -c "import numpy, spiceypy, rasterio, rasterio.warp" \
    && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app

COPY app ./app
# Stored terrain horizon profiles (backend/data/horizon, about 0.3 MB); the validation data next to them
# is not needed at run time and stays out (.dockerignore).
COPY data/horizon ./data/horizon
# Stored slopes of the preset sites (backend/data/site_slopes.json, a few kB), read by the engine adapter;
# the elevation patches they were fitted to (data/site_slopes/) stay out.
COPY data/site_slopes.json ./data/site_slopes.json

# Unprivileged user for local/container runs (Lambda always runs functions as its own non-root user).
USER 10001

EXPOSE 8080

# Shell form so $AWS_LWA_PORT is expanded; exec keeps uvicorn as PID 1 for clean shutdown.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${AWS_LWA_PORT}"]
