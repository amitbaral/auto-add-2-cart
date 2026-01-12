import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

// Configure Prisma for serverless environments
const prismaClientSingleton = () => {
  return new PrismaClient({
    datasources: {
      db: {
        // Append connection limit for serverless environments
        url: process.env.DATABASE_URL + (process.env.DATABASE_URL?.includes('?') ? '&' : '?') + 'connection_limit=1&pool_timeout=15',
      },
    },
  });
};

// In development, use global to prevent multiple instances
if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = prismaClientSingleton();
  }
}

const prisma = global.prismaGlobal ?? prismaClientSingleton();

export default prisma;
