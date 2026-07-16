import process from "node:process";
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
  npm run user:create -- --email <login> --name <displayName> --password <password> [--role USER|ADMIN|TEAM]

Examples:
  npm run user:create -- --email zhangsan --name 张三 --password test123456
  npm run user:create -- --email demo@example.com --name Demo --password test123456 --role USER
`);
}

async function main() {
  const email = getArg("email");
  const name = getArg("name") || email;
  const password = getArg("password");
  const role = (getArg("role") || "USER").toUpperCase();

  if (!email || !password) {
    printUsage();
    throw new Error("Missing required --email or --password.");
  }

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  if (!["USER", "ADMIN", "TEAM"].includes(role)) {
    throw new Error("Role must be USER, ADMIN, or TEAM.");
  }

  const passwordHash = await hashPassword(password);
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
