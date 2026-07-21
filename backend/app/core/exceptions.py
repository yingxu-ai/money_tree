from app.core import codes


class AppException(Exception):
    def __init__(self, code: int, message: str | None = None):
        self.code = code
        self.message = message or codes.DEFAULT_MESSAGES.get(code, "未知错误")
        super().__init__(self.message)


class AuthException(AppException):
    def __init__(self, message: str | None = None):
        super().__init__(codes.AUTH_FAILED, message)


class PermissionException(AppException):
    def __init__(self, message: str | None = None):
        super().__init__(codes.PERMISSION_DENIED, message)


class NotFoundException(AppException):
    def __init__(self, message: str | None = None):
        super().__init__(codes.RESOURCE_NOT_FOUND, message)


class ValidationException(AppException):
    def __init__(self, message: str | None = None):
        super().__init__(codes.VALIDATION_ERROR, message)


class ToolExecutionException(AppException):
    def __init__(self, message: str | None = None):
        super().__init__(codes.TOOL_EXECUTION_ERROR, message)


class SkillExecutionException(AppException):
    def __init__(self, message: str | None = None):
        super().__init__(codes.SKILL_EXECUTION_ERROR, message)
