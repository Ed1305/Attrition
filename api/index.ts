import { createApp } from '../server/app';

// One Express app per lambda instance: the pg pool is created lazily on first
// query and reused across warm invocations.
const app = createApp();

export default function handler(req: any, res: any) {
  return app(req, res);
}
