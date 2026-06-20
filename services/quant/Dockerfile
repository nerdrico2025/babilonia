# Babilônia Quant — imagem de produção (otimizada para Railway, portável).
#
# Usa a imagem oficial do uv já com Python 3.12. O uv resolve as dependências a
# partir do lockfile (uv.lock) de forma reprodutível e rápida.

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

# uv: instala dentro do projeto (.venv) e usa cópia (Docker layer cache amigável).
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

WORKDIR /app

# 1) Camada de dependências (cacheada enquanto pyproject/uv.lock não mudarem).
#    --no-dev: sem pytest/httpx em produção. --no-install-project: rodamos do código-fonte.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# 2) Código da aplicação.
COPY app ./app

# Garante que o venv do uv esteja no PATH.
ENV PATH="/app/.venv/bin:$PATH"

# Railway injeta a porta em $PORT; cai para 8000 em execução local do container.
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
