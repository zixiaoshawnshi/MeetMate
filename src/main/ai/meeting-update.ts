import Anthropic from '@anthropic-ai/sdk'
import { AppSettings, AiProvider } from '../settings'

interface TranscriptChunk {
  speaker: string
  text: string
  start_ms: number
}

export interface MeetingUpdateInput {
  transcript: TranscriptChunk[]
  notes: string
  agenda: string
}

export interface MeetingUpdateOutput {
  summary: string
  agenda: string
  modelUsed: string
}

const PROVIDER_DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4.1',
  openrouter: 'anthropic/claude-sonnet-4.5',
  ollama: 'llama3.1:8b'
}

const SYSTEM_PROMPT = `You are a meeting assistant. You help keep meetings on track and produce
structured, useful outputs. You will be given:
- A meeting transcript with speaker labels
- Manual notes taken by the facilitator
- The current meeting agenda in markdown format

Your job is to:
1. Write a concise free-form summary of the meeting so far.
   Include: key points discussed, decisions made, open questions.
2. Return an updated version of the agenda in the same markdown format.
   You may: tick completed items [x], add sub-items with detail from
   the discussion, annotate items with brief notes, reorder items to
   reflect the actual flow, or add new items that emerged in discussion.
   Do not remove items. Mark them skipped with [~] if needed.

Return your response in this exact format:
<summary>
...free-form summary here...
</summary>
<agenda>
...updated markdown agenda here...
</agenda>`

export async function generateMeetingUpdate(
  input: MeetingUpdateInput,
  settings: AppSettings['ai']
): Promise<MeetingUpdateOutput> {
  switch (settings.provider) {
    case 'anthropic':
      return await runAnthropicMeetingUpdate(input, settings)
    case 'openai':
      return await runOpenAiMeetingUpdate(input, settings)
    case 'openrouter':
      return await runOpenRouterMeetingUpdate(input, settings)
    case 'ollama':
      return await runOllamaMeetingUpdate(input, settings)
    default:
      throw new Error('Unknown AI provider configuration.')
  }
}

async function runAnthropicMeetingUpdate(
  input: MeetingUpdateInput,
  settings: AppSettings['ai']
): Promise<MeetingUpdateOutput> {
  const apiKey = settings.anthropicApiKey.trim()
  if (!apiKey) {
    throw new Error('Anthropic API key is missing in Settings.')
  }

  const model = (settings.model || PROVIDER_DEFAULT_MODEL.anthropic).trim()
  const client = new Anthropic({ apiKey })
  const userPrompt = buildUserPrompt(input)
  const response = await client.messages.create({
    model,
    system: SYSTEM_PROMPT,
    temperature: 0.2,
    max_tokens: 1800,
    messages: [
      {
        role: 'user',
        content: userPrompt
      }
    ]
  })

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()

  if (!text) {
    throw new Error('Anthropic returned an empty response.')
  }

  const parsed = parseMeetingUpdateResponse(text, input.agenda)
  return {
    summary: parsed.summary,
    agenda: parsed.agenda,
    modelUsed: model
  }
}

async function runOpenAiMeetingUpdate(
  input: MeetingUpdateInput,
  settings: AppSettings['ai']
): Promise<MeetingUpdateOutput> {
  const apiKey = settings.openaiApiKey.trim()
  if (!apiKey) {
    throw new Error('OpenAI API key is missing in Settings.')
  }

  const model = (settings.model || PROVIDER_DEFAULT_MODEL.openai).trim()
  const userPrompt = buildUserPrompt(input)
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ]
    }),
    signal: AbortSignal.timeout(60_000)
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenAI request failed (${response.status}): ${body || response.statusText}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>
      }
    }>
  }

  const rawContent = payload.choices?.[0]?.message?.content
  const text = extractAssistantText(rawContent).trim()
  if (!text) {
    throw new Error('OpenAI returned an empty response.')
  }

  const parsed = parseMeetingUpdateResponse(text, input.agenda)
  return {
    summary: parsed.summary,
    agenda: parsed.agenda,
    modelUsed: model
  }
}

async function runOpenRouterMeetingUpdate(
  input: MeetingUpdateInput,
  settings: AppSettings['ai']
): Promise<MeetingUpdateOutput> {
  const apiKey = settings.openrouterApiKey.trim()
  if (!apiKey) {
    throw new Error('OpenRouter API key is missing in Settings.')
  }

  const model = (settings.model || PROVIDER_DEFAULT_MODEL.openrouter).trim()
  const userPrompt = buildUserPrompt(input)
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/OpenAbilityLabs/MeetR',
      'X-Title': 'MeetR'
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ]
    }),
    signal: AbortSignal.timeout(60_000)
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenRouter request failed (${response.status}): ${body || response.statusText}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>
      }
    }>
  }
  const rawContent = payload.choices?.[0]?.message?.content
  const text = extractAssistantText(rawContent).trim()
  if (!text) {
    throw new Error('OpenRouter returned an empty response.')
  }

  const parsed = parseMeetingUpdateResponse(text, input.agenda)
  return {
    summary: parsed.summary,
    agenda: parsed.agenda,
    modelUsed: model
  }
}

async function runOllamaMeetingUpdate(
  input: MeetingUpdateInput,
  settings: AppSettings['ai']
): Promise<MeetingUpdateOutput> {
  const model = (settings.model || PROVIDER_DEFAULT_MODEL.ollama).trim()
  const baseUrl = (settings.ollamaBaseUrl || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '')
  if (!baseUrl) {
    throw new Error('Ollama base URL is missing in Settings.')
  }

  const userPrompt = buildUserPrompt(input)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  const apiKey = settings.ollamaApiKey.trim()
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      options: {
        temperature: 0.2
      }
    }),
    signal: AbortSignal.timeout(60_000)
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Ollama request failed (${response.status}): ${body || response.statusText}`)
  }

  const payload = (await response.json()) as {
    message?: { content?: string }
    response?: string
  }
  const text = (payload.message?.content || payload.response || '').trim()
  if (!text) {
    throw new Error('Ollama returned an empty response.')
  }

  const parsed = parseMeetingUpdateResponse(text, input.agenda)
  return {
    summary: parsed.summary,
    agenda: parsed.agenda,
    modelUsed: model
  }
}

function buildUserPrompt(input: MeetingUpdateInput): string {
  const transcript = input.transcript
    .map((row) => `${row.speaker}: ${row.text} [${formatTimestamp(row.start_ms)}]`)
    .join('\n')

  return [
    '## Transcript',
    transcript || '(No transcript yet)',
    '',
    '## Manual Notes',
    input.notes || '(No notes yet)',
    '',
    '## Current Agenda',
    input.agenda || '(No agenda yet)'
  ].join('\n')
}

function parseMeetingUpdateResponse(
  raw: string,
  fallbackAgenda: string
): { summary: string; agenda: string } {
  const summaryMatch = raw.match(/<summary>\s*([\s\S]*?)\s*<\/summary>/i)
  const agendaMatch = raw.match(/<agenda>\s*([\s\S]*?)\s*<\/agenda>/i)

  const summary = summaryMatch?.[1]?.trim() || raw.trim()
  const agenda = agendaMatch?.[1]?.trim() || fallbackAgenda

  if (!summary) {
    throw new Error('AI response parsing failed: summary is empty.')
  }

  return { summary, agenda }
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function extractAssistantText(
  content: string | Array<{ type?: string; text?: string }> | undefined
): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n')
}

