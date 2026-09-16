import { createApp } from "./app.ts";

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const app = createApp();

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
