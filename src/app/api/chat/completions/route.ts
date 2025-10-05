import { NextRequest, NextResponse } from "next/server";
import { Logger } from "@/utils/logger";
import OpenAI from "openai";

const logger = new Logger("API:Chat:Completions");
const gemini = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

export async function POST(req: NextRequest, res: NextResponse) {
  if (req.method !== "POST") {
    return NextResponse.json({ message: "Not Found" }, { status: 404 });
  }

  try {
    const body = await req.json();

    const {
      model,
      messages,
      max_tokens,
      temperature,
      stream,
      call,
      ...restParams
    } = body;

    // Validate required parameters
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "Messages array is required" },
        { status: 400 }
      );
    }

    const lastMessage = messages?.[messages.length - 1];
    if (!lastMessage?.content) {
      return NextResponse.json(
        { error: "Last message must have content" },
        { status: 400 }
      );
    }

    const prompt = await gemini.chat.completions.create({
      model: "gemini-2.5-flash-lite",
      messages: [
        {
          role: "user",
          content: `
        Create a prompt which can act as a prompt template where I put the original prompt and it can modify it according to my intentions so that the final modified prompt is more detailed.You can expand certain terms or keywords.
        ----------
        PROMPT: ${lastMessage.content}.
        MODIFIED PROMPT: `,
        },
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    const modifiedMessage = [
      ...messages.slice(0, messages.length - 1),
      { ...lastMessage, content: prompt.choices[0].message.content },
    ];

    if (stream) {
      const completionStream = await gemini.chat.completions.create({
        model: "gemini-2.5-flash-lite",
        messages: modifiedMessage,
        max_tokens: max_tokens || 150,
        temperature: temperature || 0.7,
        stream: true,
      } as OpenAI.Chat.ChatCompletionCreateParamsStreaming);

      // Create a proper streaming response
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of completionStream) {
              const text = `data: ${JSON.stringify(chunk)}\n\n`;
              controller.enqueue(encoder.encode(text));
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });

      return new NextResponse(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } else {
      const completion = await gemini.chat.completions.create({
        model: "gemini-2.5-flash-lite",
        messages: modifiedMessage,
        max_tokens: max_tokens || 150,
        temperature: temperature || 0.7,
        stream: false,
      });
      return NextResponse.json(completion);
    }
  } catch (e) {
    logger.error("Error in chat completions:", e);

    if (e instanceof OpenAI.APIError) {
      return NextResponse.json(
        {
          error: `API Error: ${e.message}`,
          code: e.code,
        },
        { status: e.status || 500 }
      );
    }

    return NextResponse.json(
      {
        error: "Internal server error",
        message: e instanceof Error ? e.message : "Unknown error",
        details: e,
      },
      { status: 500 }
    );
  }
}
