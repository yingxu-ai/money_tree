from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundException, ValidationException
from app.models.system import SysDictItem, SysDictType


class DictService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_types(self) -> list[dict]:
        result = await self.session.execute(
            select(SysDictType)
            .where(SysDictType.is_deleted.is_(False))
            .order_by(SysDictType.id)
        )
        return [self._serialize_type(t) for t in result.scalars().all()]

    async def create_type(self, data) -> dict:
        exists = await self.session.execute(
            select(SysDictType).where(SysDictType.code == data.code, SysDictType.is_deleted.is_(False))
        )
        if exists.scalar_one_or_none():
            raise ValidationException("字典编码已存在")
        row = SysDictType(**data.model_dump())
        self.session.add(row)
        await self.session.flush()
        return self._serialize_type(row)

    async def update_type(self, type_id: int, data) -> dict:
        row = await self._get_type(type_id)
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(row, key, value)
        return self._serialize_type(row)

    async def delete_type(self, type_id: int) -> None:
        row = await self._get_type(type_id)
        items = await self.session.execute(
            select(SysDictItem).where(
                SysDictItem.type_id == type_id, SysDictItem.is_deleted.is_(False)
            )
        )
        if items.scalars().first() is not None:
            raise ValidationException("请先删除字典项")
        row.is_deleted = True

    async def list_items(self, type_id: int | None = None, type_code: str | None = None) -> list[dict]:
        query = select(SysDictItem).where(SysDictItem.is_deleted.is_(False))
        if type_id is not None:
            query = query.where(SysDictItem.type_id == type_id)
        elif type_code:
            dtype = await self._get_type_by_code(type_code)
            query = query.where(SysDictItem.type_id == dtype.id)
        result = await self.session.execute(query.order_by(SysDictItem.sort, SysDictItem.id))
        return [self._serialize_item(i) for i in result.scalars().all()]

    async def create_item(self, data) -> dict:
        await self._get_type(data.type_id)
        row = SysDictItem(**data.model_dump())
        self.session.add(row)
        await self.session.flush()
        return self._serialize_item(row)

    async def update_item(self, item_id: int, data) -> dict:
        row = await self._get_item(item_id)
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(row, key, value)
        return self._serialize_item(row)

    async def delete_item(self, item_id: int) -> None:
        row = await self._get_item(item_id)
        row.is_deleted = True

    async def _get_type(self, type_id: int) -> SysDictType:
        result = await self.session.execute(
            select(SysDictType).where(SysDictType.id == type_id, SysDictType.is_deleted.is_(False))
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise NotFoundException("字典类型不存在")
        return row

    async def _get_type_by_code(self, code: str) -> SysDictType:
        result = await self.session.execute(
            select(SysDictType).where(SysDictType.code == code, SysDictType.is_deleted.is_(False))
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise NotFoundException("字典类型不存在")
        return row

    async def _get_item(self, item_id: int) -> SysDictItem:
        result = await self.session.execute(
            select(SysDictItem).where(SysDictItem.id == item_id, SysDictItem.is_deleted.is_(False))
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise NotFoundException("字典项不存在")
        return row

    def _serialize_type(self, row: SysDictType) -> dict:
        return {
            "id": row.id,
            "code": row.code,
            "name": row.name,
            "status": row.status,
            "description": row.description,
        }

    def _serialize_item(self, row: SysDictItem) -> dict:
        return {
            "id": row.id,
            "type_id": row.type_id,
            "label": row.label,
            "value": row.value,
            "sort": row.sort,
            "status": row.status,
            "remark": row.remark,
        }
