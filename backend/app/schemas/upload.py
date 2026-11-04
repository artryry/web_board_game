from pydantic import BaseModel, Field


class UploadRequest(BaseModel):
    content_type: str = Field(max_length=100)
    # The browser reports the file size; it is checked again with a HEAD when the art is saved.
    size: int = Field(gt=0)


class UploadTicket(BaseModel):
    upload_url: str
    art_key: str
    expires_in: int
