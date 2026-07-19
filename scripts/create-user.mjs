import process from "node:process";
import readline from "node:readline";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/password-hash.mjs";

const prisma = new PrismaClient();

function getArg(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length).trim();
  }

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) {
    return process.argv[index + 1]?.trim();
  }

  return "";
}

function printUsage() {
  console.log(`
Usage:
  npm run user:create -- --email <login> [--name <displayName>] [--role USER|ADMIN|TEAM]
  <secret-manager-command> | npm run user:create -- --email <login> --password-stdin [--role USER|ADMIN|TEAM]

Examples:
  npm run user:create -- --email zhangsan --name 张三
  Get-Content .\\one-time-password.txt | npm run user:create -- --email demo@example.com --password-stdin --role USER
`);
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function readPasswordFromStdin() {
  if (process.stdin.isTTY) {
    throw new Error("--password-stdin 需要通过标准输入传入密码。");
  }

  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) value += chunk;
  return value.replace(/\r?\n$/, "");
}

function readHiddenLine(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.reject(
      new Error("当前终端不支持隐藏输入，请改用 --password-stdin。"),
    );
  }

  return new Promise((resolve, reject) => {
    let value = "";
    const stdin = process.stdin;
    const cleanup = () => {
      stdin.off("keypress", onKeypress);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onKeypress = (text, key = {}) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.stdout.write("\n");
        reject(new Error("操作已取消。"));
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        cleanup();
        process.stdout.write("\n");
        resolve(value);
        return;
      }
      if (key.name === "backspace") {
        value = value.slice(0, -1);
        return;
      }
      if (!key.ctrl && !key.meta && typeof text === "string") {
        value += text;
      }
    };

    process.stdout.write(prompt);
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKeypress);
  });
}

async function readPasswordSecurely() {
  if (hasFlag("password-stdin")) return readPasswordFromStdin();

  const password = await readHiddenLine("Password: ");
  const confirmation = await readHiddenLine("Confirm password: ");
  if (password !== confirmation) {
    throw new Error("两次输入的密码不一致。");
  }
  return password;
}

async function main() {
  const email = getArg("email");
  const name = getArg("name") || email;
  const role = (getArg("role") || "USER").toUpperCase();

  if (process.argv.some((arg) => arg === "--password" || arg.startsWith("--password="))) {
    throw new Error(
      "--password 已停用，因为它会泄露到 shell history 和进程列表；请使用隐藏交互输入或 --password-stdin。",
    );
  }

  if (!email) {
    printUsage();
    throw new Error("Missing required --email.");
  }

  if (!["USER", "ADMIN", "TEAM"].includes(role)) {
    throw new Error("Role must be USER, ADMIN, or TEAM.");
  }

  let password = await readPasswordSecurely();

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const passwordHash = await hashPassword(password);
  password = "";
  const existing = await prisma.user.findUnique({ where: { email } });

  const user = existing
    ? await prisma.user.update({
        where: { email },
        data: {
          name,
          passwordHash,
          role,
          sessionVersion: { increment: 1 },
        },
        select: { id: true, email: true, name: true, role: true },
      })
    : await prisma.user.create({
        data: { email, name, passwordHash, role },
        select: { id: true, email: true, name: true, role: true },
      });

  console.log(
    existing
      ? `[USER] updated user id=${user.id} email=${user.email} name=${user.name ?? ""} role=${user.role}`
      : `[USER] created user id=${user.id} email=${user.email} name=${user.name ?? ""} role=${user.role}`,
  );
}

main()
  .catch((error) => {
    console.error(`[USER] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
