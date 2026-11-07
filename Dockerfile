# syntax=docker/dockerfile:1
# One API of this project with its web frontend on vantage-server:
#   docker build --platform linux/amd64 --build-arg API=books -t books .
ARG WEB_DEV=romaninsh/vantage-web-dev:1.12.3
ARG SERVER=romaninsh/vantage-server:1.12.3

# The built site is plain files, so this stage runs natively even when the image is for another platform.
FROM --platform=$BUILDPLATFORM ${WEB_DEV} AS web
ARG API
RUN test -n "$API" || { echo "pass --build-arg API=<name> (api/<name>.yaml)" >&2; exit 1; }
COPY --chown=node:node web/${API} /app
RUN node /opt/vantage/entrypoint/main.mjs build --out /app/out

FROM ${SERVER}
ARG API
COPY application.yaml /app/project/application.yaml
COPY datasource /app/project/datasource
COPY table /app/project/table
COPY api /app/project/api
# Every write the web app makes is one of these (api/books.yaml `actions:`); no page row actions.
COPY action /app/project/action
COPY --from=web /app/out /app/web
ENV VANTAGE_API=${API}
CMD ["--static", "/app/web"]
