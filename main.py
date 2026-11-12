"""FastAPI entry point for AeroIcing Watch."""

from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from src.api.icing import router as icing_router
from src.api.route_review import router as route_review_router

PROJECT_ROOT = Path(__file__).resolve().parent
load_dotenv(PROJECT_ROOT / ".env")

app = FastAPI(title="AeroIcing Watch")
app.include_router(icing_router)
app.include_router(route_review_router)
app.mount("/static", StaticFiles(directory=PROJECT_ROOT / "static"), name="static")
app.mount("/frontend", StaticFiles(directory=PROJECT_ROOT / "frontend"), name="frontend")


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(PROJECT_ROOT / "frontend" / "index.html")


@app.get("/airports.json", include_in_schema=False)
def airports_json() -> FileResponse:
    return FileResponse(PROJECT_ROOT / "airports.json", media_type="application/json")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
