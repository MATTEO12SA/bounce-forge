import type { Server } from 'node:http';

export interface CreateAdminServerOptions {
  adminPassword?: string;
  dataFile?: string;
  distDir?: string;
  apiOnly?: boolean;
}

export function createAdminServer(options?: CreateAdminServerOptions): Server;
