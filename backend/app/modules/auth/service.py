"""
AuthService orchestrates repositories across three modules (organizations,
users, roles) to implement registration/login/refresh — this is exactly
why business logic belongs in the service layer, not the router: no
single repository owns this workflow.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ConflictError, NotFoundError, UnauthorizedError
from app.core.security import (
    create_access_token,
    generate_api_key,
    generate_refresh_token,
    hash_api_key,
    hash_password,
    hash_token,
    verify_password,
)
from app.modules.audit_logs.service import AuditLogService
from app.modules.auth.models import ApiKey, RefreshToken
from app.modules.auth.repository import ApiKeyRepository, RefreshTokenRepository
from app.modules.auth.schemas import (
    ApiKeyCreateRequest,
    ApiKeyCreateResponse,
    LoginRequest,
    RegisterOrganizationRequest,
    TokenResponse,
)
from app.modules.organizations.models import Organization
from app.modules.organizations.repository import OrganizationRepository
from app.modules.roles_permissions.repository import RoleRepository
from app.modules.users.models import User
from app.modules.users.repository import UserRepository


def _slugify(name: str) -> str:
    return "-".join(name.lower().split())


class AuthService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.org_repo = OrganizationRepository(session)
        self.user_repo = UserRepository(session)
        self.role_repo = RoleRepository(session)
        self.refresh_token_repo = RefreshTokenRepository(session)
        self.api_key_repo = ApiKeyRepository(session)

    async def register_organization(self, request: RegisterOrganizationRequest) -> TokenResponse:
        existing_user = await self.user_repo.get_by_email(request.admin_email)
        if existing_user:
            raise ConflictError("An account with this email already exists.")

        base_slug = _slugify(request.organization_name)
        slug = base_slug
        suffix = 1
        while await self.org_repo.get_by_slug(slug):
            suffix += 1
            slug = f"{base_slug}-{suffix}"

        organization = await self.org_repo.create(
            Organization(name=request.organization_name, slug=slug)
        )

        user = await self.user_repo.create(
            User(
                organization_id=organization.id,
                email=request.admin_email,
                password_hash=hash_password(request.admin_password),
                full_name=request.admin_full_name,
                status="active",
            )
        )

        org_admin_role = await self.role_repo.get_system_role_by_name("org_admin")
        if not org_admin_role:
            raise NotFoundError(
                "System role 'org_admin' is missing — check that seed data has been run."
            )
        await self.role_repo.assign_role_to_user(user.id, org_admin_role.id)

        await self.session.commit()
        return await self._issue_tokens(user)

    async def login(self, request: LoginRequest) -> TokenResponse:
        user = await self.user_repo.get_by_email(request.email)
        if not user or not verify_password(request.password, user.password_hash):
            raise UnauthorizedError("Invalid email or password.")
        if user.status == "suspended":
            raise UnauthorizedError("Account is suspended.")
        if user.status == "invited":
            # First successful login activates the account.
            user.status = "active"

        user.last_login_at = datetime.now(timezone.utc)
        await self.session.commit()
        return await self._issue_tokens(user)

    async def refresh(self, refresh_token: str) -> TokenResponse:
        token_hash = hash_token(refresh_token)
        stored_token = await self.refresh_token_repo.get_valid_by_hash(token_hash)
        if not stored_token:
            raise UnauthorizedError("Refresh token is invalid, expired, or revoked.")

        user = await self.user_repo.get_by_id(stored_token.user_id)
        if not user or user.status != "active":
            raise UnauthorizedError("Account is no longer active.")

        # Rotate: revoke the used refresh token and issue a brand new pair.
        # Prevents a stolen refresh token from being replayed indefinitely.
        await self.refresh_token_repo.revoke(stored_token)
        await self.session.commit()
        return await self._issue_tokens(user)

    async def logout(self, refresh_token: str) -> None:
        token_hash = hash_token(refresh_token)
        stored_token = await self.refresh_token_repo.get_valid_by_hash(token_hash)
        if stored_token:
            await self.refresh_token_repo.revoke(stored_token)
            await self.session.commit()

    async def create_api_key(
        self, actor_user_id, organization_id, request: ApiKeyCreateRequest
    ) -> ApiKeyCreateResponse:
        plaintext_key = generate_api_key()
        api_key = await self.api_key_repo.create(
            ApiKey(
                organization_id=organization_id,
                key_hash=hash_api_key(plaintext_key),
                name=request.name,
                scopes=request.scopes,
            )
        )
        await AuditLogService(self.session, organization_id).log(
            actor_user_id, "api_key.created", "api_key", api_key.id, {"name": request.name}
        )
        await self.session.commit()
        return ApiKeyCreateResponse(
            id=api_key.id, name=api_key.name, scopes=api_key.scopes, api_key=plaintext_key
        )

    async def _issue_tokens(self, user: User) -> TokenResponse:
        role_names = await self.role_repo.get_role_names_for_user(user.id)
        access_token = create_access_token(
            subject=str(user.id),
            extra_claims={
                "organization_id": str(user.organization_id) if user.organization_id else None,
                "roles": role_names,
            },
        )

        plaintext_refresh = generate_refresh_token()
        await self.refresh_token_repo.create(
            RefreshToken(
                user_id=user.id,
                token_hash=hash_token(plaintext_refresh),
                expires_at=datetime.now(timezone.utc)
                + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
            )
        )
        await self.session.commit()

        return TokenResponse(access_token=access_token, refresh_token=plaintext_refresh)
