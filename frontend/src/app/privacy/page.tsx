import Link from "next/link";

export const metadata = { title: "Privacy Policy — RECALL" };

const SECTIONS = [
  {
    heading: "1. About this policy",
    body: "This is a placeholder privacy policy for a personal project, written to describe what the system actually does. It has not been reviewed by a lawyer. Replace it before offering the service to anyone other than yourself.",
  },
  {
    heading: "2. What is stored",
    body: "Your name, email address, and a bcrypt hash of your password (or a Google account identifier if you sign in with Google). For each document: the original file, its extracted text split into chunks, and a vector embedding per chunk. For each conversation: your messages, the assistant's replies, and which document passages were cited.",
  },
  {
    heading: "3. Where it is stored",
    body: "Original files are held in object storage. Metadata, chunk text, conversations and activity history are held in a relational database. Vector embeddings are held in a vector database. Short-lived values such as sign-in rate limits and one-time OAuth codes are held in an in-memory cache and expire automatically.",
  },
  {
    heading: "4. What leaves the system",
    body: "Embedding and reranking run locally, so document text is not sent anywhere to be indexed. When you ask a question in chat, the retrieved passages relevant to that question are sent to a third-party language model provider to generate an answer. Nothing else is shared with third parties.",
  },
  {
    heading: "5. Activity history",
    body: "RECALL records a timeline of your own activity — documents uploaded, processed, or failed, and conversations started — so it can show you recent activity. It also counts how often you open a document or conversation, in weekly buckets that expire on their own.",
  },
  {
    heading: "6. Deletion",
    body: "Deleting a document removes its stored file, its chunks, and its vectors. Your activity timeline is intentionally kept as history, but entries lose their link to anything deleted.",
  },
  {
    heading: "7. Sessions",
    body: "Sign-in uses access and refresh tokens stored in your browser. Signing out discards them locally; tokens remain valid until they expire on their own.",
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen px-6 py-16" style={{ background: "#131313" }}>
      <div className="mx-auto" style={{ maxWidth: 720 }}>
        <Link
          href="/login"
          className="text-xs font-semibold uppercase transition-colors hover:text-white"
          style={{ color: "#8e9192", letterSpacing: "0.1em" }}
        >
          ← Back
        </Link>

        <h1
          className="font-semibold text-white mt-6 mb-2"
          style={{ fontSize: 36, letterSpacing: "-0.03em" }}
        >
          Privacy Policy
        </h1>
        <p className="text-sm mb-10" style={{ color: "#8e9192" }}>
          Placeholder policy — not legal advice.
        </p>

        <div className="space-y-8">
          {SECTIONS.map((s) => (
            <section key={s.heading}>
              <h2 className="font-medium text-[#e5e2e1] mb-2" style={{ fontSize: 16 }}>
                {s.heading}
              </h2>
              <p className="text-sm" style={{ color: "#c4c7c8", lineHeight: "22px" }}>
                {s.body}
              </p>
            </section>
          ))}
        </div>

        <p className="text-xs mt-12" style={{ color: "#8e9192" }}>
          See also the{" "}
          <Link href="/terms" className="text-white hover:underline">
            Terms of Service
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
