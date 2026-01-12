import { authenticate } from "./shopify.server";

export async function checkTransform(request: Request) {
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(`
    query {
      cartTransforms(first: 10) {
        nodes {
          id
          functionId
        }
      }
    }
  `);
    return await response.json();
}
