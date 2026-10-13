FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home pet && mkdir /data && chown pet /data
COPY *.py ./
USER pet
ENV DB_PATH=/data/tinyfrens.db
EXPOSE 8080
CMD ["python", "app.py"]
