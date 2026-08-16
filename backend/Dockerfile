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

CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000"]