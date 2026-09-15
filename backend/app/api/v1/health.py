from fastapi import APIRouter, Response, status

from app.services.healthService import HealthService

router = APIRouter()


@router.get("/health")
async def liveness():
    return {"status": "alive"}


@router.get("/health/ready")
async def readiness(response: Response):
    ok, dependencies = await HealthService.readiness()
    if not ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "status": "ready" if ok else "degraded",
        "dependencies": dependencies,
    }
