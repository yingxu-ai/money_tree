"""多租户正式链路冒烟：admin 建租户/组织/账号 → 客户登录 → 隔离校验。

用法（需后端已启动）:
  python -m scripts.e2e_tenant_smoke
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from typing import Any

BASE = "http://127.0.0.1:8001/api/v1"
PASS = 0
FAIL = 0
BUGS: list[str] = []


def _req(
    method: str,
    path: str,
    *,
    token: str | None = None,
    body: dict | None = None,
    op_tenant: int | None = None,
) -> tuple[int, dict]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if op_tenant is not None:
        headers["X-Operating-Tenant-Id"] = str(op_tenant)
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"message": raw}
        return e.code, payload


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  OK  {name}" + (f" — {detail}" if detail else ""))
    else:
        FAIL += 1
        msg = f"{name}" + (f" — {detail}" if detail else "")
        BUGS.append(msg)
        print(f"  FAIL {msg}")


def data_of(payload: dict) -> Any:
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


def login(username: str, password: str) -> tuple[str | None, dict | None]:
    code, payload = _req("POST", "/auth/login", body={"username": username, "password": password})
    if code != 200 or payload.get("code") not in (0, 200, None) and payload.get("code") not in (0,):
        # project uses code 0 for success typically
        pass
    d = data_of(payload)
    if code == 200 and isinstance(d, dict) and d.get("access_token"):
        return d["access_token"], d.get("user")
    # some wrap success as code==0
    if isinstance(payload, dict) and payload.get("code") == 0:
        d = payload.get("data") or {}
        return d.get("access_token"), d.get("user")
    return None, {"http": code, "body": payload}


def wait_ready(seconds: int = 40) -> bool:
    for i in range(seconds):
        try:
            code, _ = _req("GET", "/health")
            if code in (200, 401, 403, 404):
                # any response means server up; try login path
                c2, _ = _req("POST", "/auth/login", body={"username": "x", "password": "x"})
                if c2 in (200, 400, 401, 422):
                    return True
        except Exception:
            pass
        # also try public/health
        try:
            urllib.request.urlopen(BASE.replace("/api/v1", "") + "/docs", timeout=2)
            return True
        except Exception:
            pass
        time.sleep(1)
        if i % 5 == 4:
            print(f"  … waiting backend ({i+1}s)")
    return False


def main() -> int:
    print("== wait backend ==")
    if not wait_ready():
        print("后端未启动: http://127.0.0.1:8001")
        return 2

    print("\n== 1. admin 登录 ==")
    token, user = login("admin", "admin123")
    check("admin 登录成功", bool(token), str(user)[:120] if user else "no token")
    if not token:
        print(json.dumps(user, ensure_ascii=False, indent=2))
        return 1
    check("admin 是平台账号", bool(user and user.get("is_platform_admin")), str(user))
    check("admin tenant_id=0", user.get("tenant_id") == 0, str(user.get("tenant_id")))

    print("\n== 2. 未代管时菜单仍含系统管理 ==")
    code, payload = _req("GET", "/auth/me/menus", token=token)
    menus = data_of(payload) or []
    flat = []

    def walk(nodes):
        for n in nodes or []:
            flat.append(n.get("name"))
            walk(n.get("children"))

    walk(menus)
    check("未代管可拉菜单", code == 200 and payload.get("code") == 0, f"http={code}")
    check("菜单含系统管理/租户", any("租户" in (x or "") or "系统" in (x or "") for x in flat), str(flat[:20]))

    print("\n== 3. 未代管时部门/用户列表为空不报错 ==")
    code, payload = _req("GET", "/depts", token=token)
    check("未代管 GET /depts 成功", code == 200 and payload.get("code") == 0, payload.get("message"))
    check("未代管部门为空", data_of(payload) == [], str(data_of(payload)))
    code, payload = _req("GET", "/users?page=1&page_size=20", token=token)
    check("未代管 GET /users 成功", code == 200 and payload.get("code") == 0, payload.get("message"))
    ud = data_of(payload) or {}
    check("未代管用户为空", (ud.get("total") or 0) == 0, str(ud))

    print("\n== 4. 租户列表 & 新建租户 ==")
    code, payload = _req("GET", "/tenants", token=token)
    check("GET /tenants", code == 200 and payload.get("code") == 0, payload.get("message"))
    tenants_before = data_of(payload) or []
    stamp = str(int(time.time()))[-6:]
    code, payload = _req(
        "POST",
        "/tenants",
        token=token,
        body={
            "name": f"冒烟客户{stamp}",
            "code": f"smoke_{stamp}",
            "enabled_modules": "scheduling",
            "root_dept_name": f"冒烟客户{stamp}总部",
            "remark": "e2e smoke",
        },
    )
    created = data_of(payload) or {}
    check("创建租户", code == 200 and payload.get("code") == 0 and created.get("id"), str(payload)[:200])
    tid = created.get("id")
    check("新租户仅排产", created.get("enabled_modules") == "scheduling", str(created.get("enabled_modules")))

    print("\n== 5. 代管新租户后组织/账号 ==")
    code, payload = _req("GET", "/depts", token=token, op_tenant=tid)
    depts = data_of(payload) or []
    check("代管后有部门树", code == 200 and payload.get("code") == 0 and len(depts) >= 1, str(depts)[:200])
    root_id = depts[0]["id"] if depts else None

    # 建子部门
    code, payload = _req(
        "POST",
        "/depts",
        token=token,
        op_tenant=tid,
        body={"parent_id": root_id, "name": "生产一部", "code": "P1", "sort": 1},
    )
    child = data_of(payload) or {}
    check("代管后建子部门", code == 200 and payload.get("code") == 0 and child.get("id"), str(payload)[:200])

    # 角色列表（全局角色）
    code, payload = _req("GET", "/roles", token=token, op_tenant=tid)
    roles = data_of(payload) or []
    tenant_admin = next((r for r in roles if r.get("code") == "tenant_admin"), None)
    check("存在 tenant_admin 角色", bool(tenant_admin), str([r.get("code") for r in roles]))

    user_name = f"u_smoke_{stamp}"
    code, payload = _req(
        "POST",
        "/users",
        token=token,
        op_tenant=tid,
        body={
            "username": user_name,
            "password": "Smoke123!",
            "display_name": "冒烟管理员",
            "status": "active",
            "dept_id": root_id,
            "role_ids": [tenant_admin["id"]] if tenant_admin else [],
        },
    )
    new_user = data_of(payload) or {}
    check("代管后建账号", code == 200 and payload.get("code") == 0 and new_user.get("id"), str(payload)[:300])
    check("新账号挂在正确租户", new_user.get("tenant_id") == tid, str(new_user.get("tenant_id")))

    print("\n== 6. 代管仅排产租户时平台菜单不被裁 ==")
    code, payload = _req("GET", "/auth/me/menus", token=token, op_tenant=tid)
    flat2 = []

    def walk2(nodes):
        for n in nodes or []:
            flat2.append((n.get("name"), n.get("path")))
            walk2(n.get("children"))

    walk2(data_of(payload) or [])
    check(
        "代管后仍有租户管理菜单",
        any(p == "/system/tenants" or (n and "租户" in n) for n, p in flat2),
        str(flat2[:30]),
    )
    code, payload = _req("GET", "/auth/me", token=token, op_tenant=tid)
    me = data_of(payload) or {}
    check(
        "代管后 enabled_modules 仍全开(null)",
        me.get("enabled_modules") is None,
        str(me.get("enabled_modules")),
    )
    check("me 带回 operating_tenant_id", me.get("operating_tenant_id") == tid, str(me.get("operating_tenant_id")))

    print("\n== 7. 客户账号登录 ==")
    ctok, cuser = login(user_name, "Smoke123!")
    check("客户登录成功", bool(ctok), str(cuser)[:160] if cuser else "fail")
    if ctok and cuser:
        check("客户非平台", not cuser.get("is_platform_admin"), str(cuser.get("is_platform_admin")))
        check("客户 tenant_id 正确", cuser.get("tenant_id") == tid, str(cuser.get("tenant_id")))
        check(
            "客户 enabled_modules 含 scheduling",
            cuser.get("enabled_modules") is None or "scheduling" in (cuser.get("enabled_modules") or []),
            str(cuser.get("enabled_modules")),
        )

        code, payload = _req("GET", "/auth/me/menus", token=ctok)
        flat_c = []

        def walkc(nodes):
            for n in nodes or []:
                flat_c.append(n.get("path"))
                walkc(n.get("children"))

        walkc(data_of(payload) or [])
        check("客户有排产菜单", any(p and p.startswith("/scheduling") for p in flat_c), str(flat_c))
        check(
            "客户有组织自管菜单",
            any(p in ("/system/users", "/system/depts", "/system/roles") for p in flat_c),
            str(flat_c),
        )
        check("客户无租户管理", "/system/tenants" not in flat_c, str(flat_c))

        print("\n== 8. 客户只能看本租户组织 ==")
        code, payload = _req("GET", "/depts", token=ctok)
        cdepts = data_of(payload) or []
        check(
            "客户能看部门",
            code == 200 and payload.get("code") == 0 and len(cdepts) >= 1,
            f"code={payload.get('code')} msg={payload.get('message')} data={str(cdepts)[:160]}",
        )

        # 试图访问租户 API
        code, payload = _req("GET", "/tenants", token=ctok)
        check(
            "客户不能列租户",
            code != 200 or payload.get("code") != 0,
            f"http={code} code={payload.get('code')} msg={payload.get('message')}",
        )

        print("\n== 9. 排产按租户隔离 ==")
        code, payload = _req("GET", "/scheduling/master", token=ctok)
        check("客户可访问排产 master", code == 200 and payload.get("code") == 0, payload.get("message"))
        # 设备分析应对仅排产租户拦截
        code, payload = _req("GET", "/equipment-analysis/devices", token=ctok)
        blocked = code == 403 or (isinstance(payload, dict) and payload.get("code") not in (0, None) and code != 200)
        # FastAPI HTTPException 403 may not use business code
        check("客户访问设备分析被拦", code in (403, 401) or payload.get("code") not in (0,), f"http={code} {str(payload)[:160]}")

    print("\n== 10. 跨租户：代管 A 看不到 B 的部门写入串 ==")
    # 用已有 tenant 2 (customer_a) 与新 tid
    code, payload = _req("GET", "/depts", token=token, op_tenant=2)
    depts2 = data_of(payload) or []
    ids2 = []

    def collect(nodes, out):
        for n in nodes or []:
            out.append(n["id"])
            collect(n.get("children"), out)

    collect(depts2, ids2)
    code, payload = _req("GET", "/depts", token=token, op_tenant=tid)
    depts_n = data_of(payload) or []
    ids_n = []
    collect(depts_n, ids_n)
    check("两租户部门 id 不交叉", not set(ids2) & set(ids_n), f"t2={ids2} new={ids_n}")

    # 客户不能改别人部门
    if ctok and root_id:
        code, payload = _req(
            "POST",
            "/depts",
            token=ctok,
            body={"parent_id": 1, "name": "hack", "code": "HACK"},
        )
        check(
            "客户不能挂到外租户部门 parent",
            code != 200 or payload.get("code") != 0,
            f"http={code} {payload.get('message')}",
        )

    print("\n======== 结果 ========")
    print(f"通过 {PASS} / 失败 {FAIL}")
    if BUGS:
        print("发现的问题:")
        for b in BUGS:
            print(f"  - {b}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
