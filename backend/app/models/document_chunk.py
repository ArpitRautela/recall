from sqlalchemy import Column, Integer, String, Text, ForeignKey, Index, UniqueConstraint
from app.models.base import Base


class DocumentChunk(Base):
    __tablename__ = "document_chunks"
    __table_args__ = (
        UniqueConstraint("document_id", "chunk_index", name="uq_document_chunk_index"),
        # Powers the lexical half of hybrid search (MATCH ... AGAINST in SearchService).
        # Declared here, not only in the migration: autogenerate compares against model
        # metadata, so an undeclared index looks extraneous and the next generated
        # migration would drop it.
        Index("ft_document_chunks_content", "content", mysql_prefix="FULLTEXT"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)
    page_number = Column(Integer, nullable=True)
    content = Column(Text, nullable=False)
    token_count = Column(Integer, nullable=False)
    qdrant_point_id = Column(String(36), nullable=False)
