// Generates the Ed25519 key pair pipper.dev uses to sign laptop ownership
// (docs/remote-access.md). Prints the two values to configure; nothing is
// written to disk.
//   PIPPER_LAPTOP_ATTESTATION_KEY      -> pipper.dev (Vercel) env, secret
//   VITE_REMOTE_ATTESTATION_PUBLIC_KEY -> hosted phone app build env, public
import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const raw = publicKey.export({ format: "jwk" }).x;
console.log(`PIPPER_LAPTOP_ATTESTATION_KEY=${pkcs8}`);
console.log(`VITE_REMOTE_ATTESTATION_PUBLIC_KEY=${raw}`);
