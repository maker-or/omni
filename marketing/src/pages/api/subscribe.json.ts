import type { APIRoute } from "astro";
import crypto from "crypto";

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
      return new Response(JSON.stringify({ error: "Please provide a valid email address." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const apiKey = import.meta.env.MAILCHIMP_API_KEY || process.env.MAILCHIMP_API_KEY;
    const datacenter = import.meta.env.MAILCHIMP_DC || process.env.MAILCHIMP_DC;
    const listId = import.meta.env.MAILCHIMP_LIST_ID || process.env.MAILCHIMP_LIST_ID;
    const tag = import.meta.env.MAILCHIMP_TAG || process.env.MAILCHIMP_TAG;

    if (!apiKey || !datacenter || !listId) {
      console.error("Missing Mailchimp configuration environment variables.");
      return new Response(
        JSON.stringify({ error: "Newsletter subscription is temporarily unavailable." }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const cleanEmail = email.trim().toLowerCase();
    const subscriberHash = crypto.createHash("md5").update(cleanEmail).digest("hex");

    // 1. Subscribe / Upsert member in the list
    const memberUrl = `https://${datacenter}.api.mailchimp.com/3.0/lists/${listId}/members/${subscriberHash}`;
    const authHeader = `Basic ${btoa(`anykey:${apiKey}`)}`;

    const memberResponse = await fetch(memberUrl, {
      method: "PUT",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_address: cleanEmail,
        status_if_new: "subscribed",
        status: "subscribed",
      }),
    });

    if (!memberResponse.ok) {
      const errorData = await memberResponse.json().catch(() => ({}));
      console.error("Mailchimp Member API error:", errorData);
      return new Response(
        JSON.stringify({ error: errorData.detail || "Failed to subscribe to the newsletter." }),
        { status: memberResponse.status, headers: { "Content-Type": "application/json" } },
      );
    }

    // 2. Add Tag if configured
    if (tag && tag.trim()) {
      const tagUrl = `https://${datacenter}.api.mailchimp.com/3.0/lists/${listId}/members/${subscriberHash}/tags`;
      const tagResponse = await fetch(tagUrl, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tags: [
            {
              name: tag.trim(),
              status: "active",
            },
          ],
        }),
      });

      if (!tagResponse.ok) {
        const errorData = await tagResponse.json().catch(() => ({}));
        console.error("Mailchimp Tag API error:", errorData);
        // Do not fail the request if just the tag fails to apply
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Subscription API endpoint error:", error);
    return new Response(JSON.stringify({ error: "Internal server error occurred." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
