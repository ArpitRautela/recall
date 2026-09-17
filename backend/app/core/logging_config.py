import logging
import os
import sys

# RAG retrieval decisions are the thing most often being debugged, so they get
# their own logger that can be turned up independently of everything else.
RAG_LOGGER = "recall.rag"


def configure_logging() -> None:
    """Set up console logging once, at startup.

    LOG_LEVEL     overall level (default INFO)
    RAG_LOG_LEVEL retrieval detail (default INFO; set DEBUG for per-candidate scores)
    """
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    rag_level = os.getenv("RAG_LOG_LEVEL", "INFO").upper()

    root = logging.getLogger()
    if any(getattr(h, "_recall_configured", False) for h in root.handlers):
        return  # uvicorn --reload re-imports; don't stack duplicate handlers

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(
        fmt="%(asctime)s %(levelname)-5s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    ))
    handler._recall_configured = True  # type: ignore[attr-defined]

    root.setLevel(level)
    root.addHandler(handler)

    logging.getLogger(RAG_LOGGER).setLevel(rag_level)

    # These are noisy at DEBUG and drown out anything useful.
    for noisy in ("httpx", "httpcore", "urllib3", "sentence_transformers", "qdrant_client"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
