FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt .

# CPU-only torch build first — the default PyPI wheel pulls several GB of
# NVIDIA CUDA/cuDNN packages that this container has no GPU to use.
# sentence-transformers (in requirements.txt) is satisfied by this and
# won't reinstall the CUDA variant.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# --proxy-headers makes uvicorn honour X-Forwarded-Proto/For, which a PaaS or
# reverse proxy sets when it terminates TLS. Without it the app believes every
# request is plain HTTP and sees the proxy's address as the client, which breaks
# the login rate limiter (every attempt looks like one IP).
# --forwarded-allow-ips="*" is safe only because nothing but the platform's proxy
# can reach the container; do not expose this port directly to the internet.
# $PORT is honoured because most PaaS platforms assign it at runtime.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]