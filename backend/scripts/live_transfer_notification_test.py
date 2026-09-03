import asyncio
import json
import uuid

import httpx
import websockets

BASE = "http://localhost:8000"
WS_BASE = "ws://localhost:8000"


async def main():
    async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as client:
        org_name = f"Transfer Test {uuid.uuid4().hex[:6]}"
        slug = "-".join(org_name.lower().split())
        admin_email = f"admin-{uuid.uuid4().hex[:8]}@transfer.com"

        reg = await client.post(
            "/api/v1/auth/register",
            json={
                "organization_name": org_name,
                "admin_full_name": "Admin",
                "admin_email": admin_email,
                "admin_password": "SuperSecret123",
            },
        )
        admin_token = reg.json()["access_token"]

        agent_email = f"agent-{uuid.uuid4().hex[:8]}@transfer.com"
        invite = await client.post(
            "/api/v1/users",
            json={
                "email": agent_email,
                "full_name": "Target Agent",
                "temporary_password": "TempPass123",
                "role": "agent",
            },
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        agent_id = invite.json()["id"]

        agent_login = await client.post(
            "/api/v1/auth/login", json={"email": agent_email, "password": "TempPass123"}
        )
        agent_token = agent_login.json()["access_token"]

        # Agent connects to their dashboard socket BEFORE the transfer happens
        agent_ws = await websockets.connect(
            f"{WS_BASE}/api/v1/conversations/ws/agent?token={agent_token}"
        )
        print("Agent dashboard WebSocket connected, waiting for transfer notification...")

        start = await client.post(
            f"/api/v1/public/{slug}/conversations",
            json={"external_id": "visitor-transfer", "initial_message": "Need help", "full_name": "Test Visitor", "phone": "9990001111"},
        )
        conversation_id = start.json()["id"]

        # Drain the "new_conversation" notification that also fires
        first_event = json.loads(await asyncio.wait_for(agent_ws.recv(), timeout=5))
        print(f"(drained: {first_event['type']})")
        assert first_event["type"] == "new_conversation"

        print(f"\nAdmin transfers conversation {conversation_id} to agent {agent_id}...")
        transfer_resp = await client.patch(
            f"/api/v1/conversations/{conversation_id}",
            json={"assigned_agent_id": agent_id},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert transfer_resp.status_code == 200

        transfer_event = json.loads(await asyncio.wait_for(agent_ws.recv(), timeout=5))
        print(f"RECEIVED by agent: {transfer_event}")
        assert transfer_event["type"] == "conversation_transferred"
        assert transfer_event["conversation_id"] == conversation_id
        assert transfer_event["assigned_agent_id"] == agent_id
        print("\nOK — transfer notification pushed to agent dashboard in real time")

        await agent_ws.close()


if __name__ == "__main__":
    asyncio.run(main())
