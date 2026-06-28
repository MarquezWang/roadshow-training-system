import { loginAction } from "./actions";

type LoginPageProps = Readonly<{
  searchParams?: Promise<{
    error?: string;
    next?: string;
  }>;
}>;

function getErrorMessage(error: string | undefined) {
  if (error === "config") {
    return "登录配置未完成，请检查服务器环境变量。";
  }

  if (error === "invalid") {
    return "账号或密码不正确。";
  }

  return "";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = (await searchParams) ?? {};
  const next = params.next?.startsWith("/") ? params.next : "/projects";
  const errorMessage = getErrorMessage(params.error);

  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 px-6 py-10 text-white">
      <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl shadow-black/30">
        <div>
          <p className="text-sm font-medium text-cyan-300">
            Roadshow Training System
          </p>
          <h1 className="mt-3 text-3xl font-semibold">登录</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            请输入内部测试账号，继续访问项目与训练内容。
          </p>
        </div>

        {errorMessage ? (
          <div className="mt-6 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {errorMessage}
          </div>
        ) : null}

        <form action={loginAction} className="mt-8 space-y-5">
          <input type="hidden" name="next" value={next} />

          <label className="block">
            <span className="text-sm font-medium text-slate-200">用户名</span>
            <input
              autoComplete="username"
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300"
              name="username"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-200">密码</span>
            <input
              autoComplete="current-password"
              className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300"
              name="password"
              required
              type="password"
            />
          </label>

          <button
            className="w-full rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
            type="submit"
          >
            登录
          </button>
        </form>
      </section>
    </main>
  );
}
