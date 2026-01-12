import { Pool, neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";
import ws from "ws";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

// Configure for serverless
neonConfig.webSocketConstructor = ws;

const createPrismaClient = () => {
  const connectionString = process.env.DATABASE_URL;

  // Use Neon serverless adapter in production
  if (process.env.NODE_ENV === "production") {
    const pool = new Pool({ connectionString });
    const adapter = new PrismaNeon(pool);
    return new PrismaClient({ adapter });
  }

  // Use regular Prisma in development
  return new PrismaClient();
};

// In development, use global to prevent multiple instances
if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createPrismaClient();
  }
}

const prisma = global.prismaGlobal ?? createPrismaClient();

export default prisma;
