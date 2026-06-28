import Link from "next/link";
import { createUserAction, resetUserPasswordAction, updateUserAction } from "./actions";
import { requireAdminUser } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type UsersPageProps = {
  searchParams?: Promise<{
    status?: string;
  }>;
};

const statusMessages: Record<string, string> = {
  created: "用户已创建。",
  updated: "用户信息已更新。",
  password: "密码已重置。",
  error: "操作失败，请检查登录名是否重复、密码是否至少 8 位。",
};

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export default async function AdminUsersPage({ searchParams }: UsersPageProps) {
  const currentUser = await requireAdminUser();
  const params = (await searchParams) ?? {};
  const status = params.status;

  const users = await prisma.user.findMany({
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      passwordHash: true,
      createdAt: true,
      _count: {
        select: {
          projects: true,
        },
      },
    },
  });

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">管理员工具</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">
            用户管理
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            创建内测账号、修改用户名称和角色，或重置用户密码。
          </p>
        </div>
        <Link
          href="/projects"
          className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          返回项目列表
        </Link>
      </div>

      {status && statusMessages[status] ? (
        <div
          className={`mt-6 rounded-lg border px-4 py-3 text-sm ${
            status === "error"
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-teal-200 bg-teal-50 text-teal-800"
          }`}
        >
          {statusMessages[status]}
        </div>
      ) : null}

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">新建用户</h2>
        <form action={createUserAction} className="mt-4 grid gap-4 lg:grid-cols-5">
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">登录名</span>
            <input
              name="email"
              required
              className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              placeholder="例如 test1"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">显示名</span>
            <input
              name="name"
              className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              placeholder="例如 测试用户1"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">初始密码</span>
            <input
              name="password"
              type="password"
              minLength={8}
              required
              className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              placeholder="至少 8 位"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">角色</span>
            <select
              name="role"
              defaultValue="USER"
              className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              <option value="USER">USER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </label>
          <div className="flex items-end">
            <button className="w-full rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800">
              创建用户
            </button>
          </div>
        </form>
      </section>

      <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">用户列表</h2>
          <p className="mt-1 text-sm text-slate-500">
            当前共 {users.length} 个用户。当前登录用户不能被降级。
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">登录名</th>
                <th className="px-5 py-3">显示名 / 角色</th>
                <th className="px-5 py-3">账号状态</th>
                <th className="px-5 py-3">项目数</th>
                <th className="px-5 py-3">创建时间</th>
                <th className="px-5 py-3">重置密码</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((user) => (
                <tr key={user.id} className="align-top">
                  <td className="px-5 py-4">
                    <div className="font-medium text-slate-950">{user.email}</div>
                    <div className="mt-1 text-xs text-slate-400">{user.id}</div>
                    {user.email === "team@roadshow.local" ? (
                      <div className="mt-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        历史项目账号
                      </div>
                    ) : null}
                  </td>
                  <td className="px-5 py-4">
                    <form action={updateUserAction} className="grid gap-2">
                      <input type="hidden" name="id" value={user.id} />
                      <input
                        name="name"
                        defaultValue={user.name}
                        required
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                      />
                      <div className="flex gap-2">
                        <select
                          name="role"
                          defaultValue={user.role}
                          disabled={user.id === currentUser.id}
                          className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100 disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          <option value="USER">USER</option>
                          <option value="ADMIN">ADMIN</option>
                          <option value="TEAM">TEAM</option>
                        </select>
                        <button className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
                          保存
                        </button>
                      </div>
                      {user.id === currentUser.id ? (
                        <p className="text-xs text-slate-400">
                          当前登录用户保持 ADMIN 角色。
                        </p>
                      ) : null}
                    </form>
                  </td>
                  <td className="px-5 py-4 text-slate-700">
                    <div
                      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${
                        user.passwordHash
                          ? "border-teal-200 bg-teal-50 text-teal-700"
                          : "border-slate-200 bg-slate-50 text-slate-500"
                      }`}
                    >
                      {user.passwordHash ? "可登录" : "不可登录"}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-slate-700">
                    {user._count.projects}
                  </td>
                  <td className="px-5 py-4 text-slate-500">
                    {formatDate(user.createdAt)}
                  </td>
                  <td className="px-5 py-4">
                    <form action={resetUserPasswordAction} className="flex gap-2">
                      <input type="hidden" name="id" value={user.id} />
                      <input
                        name="password"
                        type="password"
                        minLength={8}
                        required
                        className="w-40 rounded-md border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                        placeholder="新密码"
                      />
                      <button className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
                        重置
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
