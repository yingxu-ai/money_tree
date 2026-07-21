from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.core.database import get_session
from app.core.response import ok
from app.runtime.pipeline import QueryPipeline
from app.skills.base import SkillContext
from app.skills.registry import skill_registry
from app.tools.base import ToolContext
from app.tools.registry import tool_registry

router = APIRouter(tags=["AI Runtime"])


class ToolExecuteRequest(BaseModel):
    inputs: dict = Field(default_factory=dict)


class SkillExecuteRequest(BaseModel):
    inputs: dict = Field(default_factory=dict)


class QueryRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    factory_id: int = 1


@router.get("/tools")
async def list_tools(request: Request, current=Depends(get_current_user)):
    tools = [
        {
            "name": t.name,
            "version": t.version,
            "description": t.description,
            "permission": t.permission,
            "read_only": t.read_only,
        }
        for t in tool_registry.list_tools()
    ]
    return ok(request, tools)


@router.post("/tools/{tool_name}/execute")
async def execute_tool(
    tool_name: str,
    payload: ToolExecuteRequest,
    request: Request,
    current=Depends(get_current_user),
):
    ctx = ToolContext(
        tenant_id=current.tenant_id,
        user_id=current.id,
        trace_id=getattr(request.state, "trace_id", ""),
        permissions=current.permissions,
    )
    result = await tool_registry.execute(tool_name, payload.inputs, ctx)
    return ok(request, result)


@router.get("/skills")
async def list_skills(request: Request, current=Depends(get_current_user)):
    skills = [
        {
            "name": s.name,
            "version": s.version,
            "description": s.description,
            "permissions": s.permissions,
            "tools": s.tools,
        }
        for s in skill_registry.list_skills()
    ]
    return ok(request, skills)


@router.post("/skills/{skill_name}/execute")
async def execute_skill(
    skill_name: str,
    payload: SkillExecuteRequest,
    request: Request,
    current=Depends(get_current_user),
):
    ctx = SkillContext(
        tenant_id=current.tenant_id,
        user_id=current.id,
        trace_id=getattr(request.state, "trace_id", ""),
        permissions=current.permissions,
    )
    result = await skill_registry.execute(skill_name, payload.inputs, ctx)
    return ok(request, result)


@router.post("/ai/query")
async def ai_query(
    payload: QueryRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current=Depends(get_current_user),
):
    """自然语言入口：走 Query Pipeline 自动路由到 API / Tool / Skill。"""
    pipeline = QueryPipeline(session)
    result = await pipeline.run(
        query=payload.query,
        tenant_id=current.tenant_id,
        user_id=current.id,
        permissions=current.permissions,
        trace_id=getattr(request.state, "trace_id", ""),
        factory_id=payload.factory_id,
    )
    return ok(request, result.to_dict())
