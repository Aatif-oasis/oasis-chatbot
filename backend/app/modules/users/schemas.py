import uuid

from pydantic import BaseModel, EmailStr, Field


class UserInviteRequest(BaseModel):
    """
    Creates a user directly with a temporary password rather than a true
    email-invite flow — email delivery is out of scope for Module 2
    (belongs with the Notifications module later in the roadmap).
    """
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=255)
    temporary_password: str = Field(min_length=8, max_length=128)
    role: str = Field(pattern="^(org_admin|team_manager|agent)$")


class UserUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=255)
    status: str | None = Field(default=None, pattern="^(active|invited|suspended)$")


class PasswordResetRequest(BaseModel):
    """An admin setting a new password for someone who is locked out."""
    new_password: str = Field(min_length=8, max_length=128)


class UserRoleAssignRequest(BaseModel):
    role: str = Field(pattern="^(org_admin|team_manager|agent)$")


class UserResponse(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID | None
    email: EmailStr
    full_name: str
    status: str
    roles: list[str] = []

    model_config = {"from_attributes": True}
