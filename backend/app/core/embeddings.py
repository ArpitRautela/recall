EMBEDDING_MODEL_NAME = "BAAI/bge-small-en-v1.5"

_embedding_model = None


def get_embedding_model():
    global _embedding_model
    if _embedding_model is None:
        from sentence_transformers import SentenceTransformer

        _embedding_model = SentenceTransformer(EMBEDDING_MODEL_NAME)
    return _embedding_model


def embed_texts(texts: list[str]) -> list[list[float]]:
    vectors = get_embedding_model().encode(texts, batch_size=32, normalize_embeddings=True)
    return vectors.tolist()
