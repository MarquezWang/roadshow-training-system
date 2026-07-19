import assert from "node:assert/strict";
import test from "node:test";

import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../lib/password-hash.mjs";

const prisma = new PrismaClient();
const baseUrl = process.env.AUTH_E2E_BASE_URL;

const fixtures = {
  userA: {
    id: "auth-e2e-user-a",
    email: "auth-e2e-a@example.test",
    name: "Auth E2E User A",
    password: "correct-password-a",
  },
  userB: {
    id: "auth-e2e-user-b",
    email: "auth-e2e-b@example.test",
    name: "Auth E2E User B",
    password: "correct-password-b",
  },
  admin: {
    id: "auth-e2e-admin",
    email: "auth-e2e-admin@example.test",
    name: "Auth E2E Admin",
    password: "correct-admin-password",
  },
  projectA: {
    id: "auth-e2e-project-a",
    name: "AUTH_E2E_PRIVATE_ALPHA",
  },
  projectB: {
    id: "auth-e2e-project-b",
    name: "AUTH_E2E_PRIVATE_BETA",
  },
  sessionA: {
    id: "auth-e2e-session-a",
  },
};

function request(pathname, cookie, options = {}) {
  const headers = new Headers(options.headers);
  if (cookie) {
    headers.set("cookie", cookie);
  }

  return fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers,
    redirect: options.redirect ?? "manual",
  });
}

function authCookieFromResponse(response) {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/(?:^|,\s*)(roadshow_auth=[^;]+)/);
  assert.ok(match, `login response must set roadshow_auth: ${setCookie}`);
  return match[1];
}

async function login(email, password) {
  const pageResponse = await request("/login", null, {
    headers: { accept: "text/html" },
  });
  assert.equal(pageResponse.status, 200);
  const html = await pageResponse.text();
  const actionField = html.match(/name="(\$ACTION_ID_[^"]+)"/);
  assert.ok(actionField, "login page must expose a progressive Server Action field");

  const form = new FormData();
  form.set(actionField[1], "");
  form.set("next", "/projects");
  form.set("username", email);
  form.set("password", password);

  const response = await request("/login", null, {
    method: "POST",
    body: form,
    headers: { origin: baseUrl },
  });
  assert.ok([302, 303, 307].includes(response.status));
  assert.equal(new URL(response.headers.get("location"), baseUrl).pathname, "/projects");
  return authCookieFromResponse(response);
}

async function seedFixtures() {
  const [passwordA, passwordB, adminPassword] = await Promise.all([
    hashPassword(fixtures.userA.password),
    hashPassword(fixtures.userB.password),
    hashPassword(fixtures.admin.password),
  ]);

  await prisma.user.createMany({
    data: [
      {
        id: fixtures.userA.id,
        email: fixtures.userA.email,
        name: fixtures.userA.name,
        passwordHash: passwordA,
        role: "TEAM",
      },
      {
        id: fixtures.userB.id,
        email: fixtures.userB.email,
        name: fixtures.userB.name,
        passwordHash: passwordB,
        role: "TEAM",
      },
      {
        id: fixtures.admin.id,
        email: fixtures.admin.email,
        name: fixtures.admin.name,
        passwordHash: adminPassword,
        role: "ADMIN",
      },
    ],
  });

  const projectData = (fixture, ownerId) => ({
    id: fixture.id,
    ownerId,
    name: fixture.name,
    field: "E2E",
    stage: "TEST",
    summary: `${fixture.name} summary`,
    coreTechnology: "test",
    applicationScenario: "test",
    businessModel: "test",
    cooperationDemand: "test",
  });
  await prisma.project.createMany({
    data: [
      projectData(fixtures.projectA, fixtures.userA.id),
      projectData(fixtures.projectB, fixtures.userB.id),
    ],
  });
  await prisma.trainingSession.create({
    data: {
      id: fixtures.sessionA.id,
      projectId: fixtures.projectA.id,
      status: "CREATED",
    },
  });
}

test("AUTH_ENABLED isolates users, enforces admin scope, and invalidates sessions", async () => {
  assert.ok(baseUrl, "AUTH_E2E_BASE_URL is required");
  await seedFixtures();

  try {
    let cookieA = await login(fixtures.userA.email, fixtures.userA.password);
    const cookieB = await login(fixtures.userB.email, fixtures.userB.password);
    const adminCookie = await login(
      fixtures.admin.email,
      fixtures.admin.password,
    );

    await test("authenticated identity comes from the database-backed session", async () => {
      const response = await request("/api/auth/me", cookieA);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.authEnabled, true);
      assert.equal(body.user.id, fixtures.userA.id);
      assert.equal(body.user.role, "TEAM");
    });

    await test("normal users only see their own project list", async () => {
      const [responseA, responseB] = await Promise.all([
        request("/projects", cookieA, { headers: { accept: "text/html" } }),
        request("/projects", cookieB, { headers: { accept: "text/html" } }),
      ]);
      assert.equal(responseA.status, 200);
      assert.equal(responseB.status, 200);
      const [htmlA, htmlB] = await Promise.all([
        responseA.text(),
        responseB.text(),
      ]);
      assert.match(htmlA, new RegExp(fixtures.projectA.name));
      assert.doesNotMatch(htmlA, new RegExp(fixtures.projectB.name));
      assert.match(htmlB, new RegExp(fixtures.projectB.name));
      assert.doesNotMatch(htmlB, new RegExp(fixtures.projectA.name));
    });

    await test("cross-user page, API, and destructive access fail closed", async () => {
      const [page, statusApi, deletion] = await Promise.all([
        request(`/projects/${fixtures.projectA.id}`, cookieB, {
          headers: { accept: "text/html" },
        }),
        request(`/training/${fixtures.sessionA.id}/status`, cookieB),
        request(`/projects/${fixtures.projectA.id}/delete`, cookieB, {
          method: "POST",
        }),
      ]);
      assert.equal(page.status, 404);
      assert.equal(statusApi.status, 404);
      assert.equal(deletion.status, 404);
      assert.equal(
        await prisma.project.count({ where: { id: fixtures.projectA.id } }),
        1,
      );

      const ownerStatus = await request(
        `/training/${fixtures.sessionA.id}/status`,
        cookieA,
      );
      assert.equal(ownerStatus.status, 200);
    });

    await test("TEAM users cannot enter admin pages while ADMIN can inspect all projects", async () => {
      const [teamAdminPage, adminPage, adminProject] = await Promise.all([
        request("/admin/users", cookieA, {
          headers: { accept: "text/html" },
        }),
        request("/admin/users", adminCookie, {
          headers: { accept: "text/html" },
        }),
        request(`/projects/${fixtures.projectA.id}`, adminCookie, {
          headers: { accept: "text/html" },
        }),
      ]);
      assert.equal(teamAdminPage.status, 404);
      assert.equal(adminPage.status, 200);
      assert.equal(adminProject.status, 200);
    });

    await test("missing and tampered cookies receive a 401 before protected APIs", async () => {
      const [missing, tampered] = await Promise.all([
        request(`/training/${fixtures.sessionA.id}/status`, null),
        request(
          `/training/${fixtures.sessionA.id}/status`,
          "roadshow_auth=forged.payload",
        ),
      ]);
      assert.equal(missing.status, 401);
      assert.equal(tampered.status, 401);
    });

    await test("sessionVersion changes invalidate a previously valid cookie", async () => {
      await prisma.user.update({
        where: { id: fixtures.userA.id },
        data: { sessionVersion: { increment: 1 } },
      });

      const identity = await request("/api/auth/me", cookieA);
      assert.equal((await identity.json()).user, null);

      const protectedPage = await request("/projects", cookieA, {
        headers: { accept: "text/html" },
      });
      assert.ok([302, 303, 307, 308].includes(protectedPage.status));
      assert.equal(
        new URL(protectedPage.headers.get("location"), baseUrl).pathname,
        "/login",
      );

      cookieA = await login(fixtures.userA.email, fixtures.userA.password);
      const refreshedIdentity = await request("/api/auth/me", cookieA);
      assert.equal((await refreshedIdentity.json()).user.id, fixtures.userA.id);
    });

    await test("disabling a user invalidates their existing cookie", async () => {
      await prisma.user.update({
        where: { id: fixtures.userB.id },
        data: { disabledAt: new Date() },
      });
      const identity = await request("/api/auth/me", cookieB);
      assert.equal((await identity.json()).user, null);

      const protectedPage = await request("/projects", cookieB, {
        headers: { accept: "text/html" },
      });
      assert.ok([302, 303, 307, 308].includes(protectedPage.status));
      assert.equal(
        new URL(protectedPage.headers.get("location"), baseUrl).pathname,
        "/login",
      );
    });
  } finally {
    await prisma.$disconnect();
  }
});
