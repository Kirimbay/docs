FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssh-client && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
COPY src ./src
RUN pip install --no-cache-dir .

COPY config/servers.example.yaml config/servers.example.yaml

ENV HIDDIFY_HUB_CONFIG=/app/config/servers.yaml
ENV HIDDIFY_HUB_DB=/app/data/hub.db

EXPOSE 8080
CMD ["hiddify-hub", "serve"]
