FROM python:3.12-slim
WORKDIR /srv
COPY pyproject.toml ./
COPY beta_service ./beta_service
RUN pip install --no-cache-dir .
CMD ["python", "-m", "beta_service"]
