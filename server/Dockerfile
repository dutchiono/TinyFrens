FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home pet && mkdir /data && chown pet /data
COPY app.py economy.py turtle_connect.py hood_turtle_art.py robot_companion.py robot_care.py admin.py telegram_integration.py telegram_media.py discord_integration.py device_sync.py account_profile.py .
USER pet
ENV DB_PATH=/data/tinyfrens.db
EXPOSE 8080
CMD ["python", "app.py"]
