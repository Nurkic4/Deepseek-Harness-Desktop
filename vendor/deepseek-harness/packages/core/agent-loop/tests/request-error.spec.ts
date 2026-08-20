import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, LlmError  } from '@deepseek-ai/dsh-llm'
import type { LlmFailure, ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from './mock-adapter.ts'

async function harness(adapter: MockAdapter, visionFallback?: object): Promise<Context> {
  const ctx = new Context()
  if (visionFallback !== undefined) ctx.provide('visionFallback' as never, visionFallback as never)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function fail(message: string, code: string): () => never {
  return () => {
    throw new LlmError(message, code)
  }
}

describe('agent/request-error', () => {
  it('retries image input through the vision fallback after an explicit unsupported-content failure', async () => {
    const adapter = new MockAdapter([
      [
        { type: 'usage', usage: { inputTokens: 1, outputTokens: 0 } },
        {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: { message: 'this text-only model does not support image input', code: 'UNSUPPORTED_CONTENT' },
          },
        },
      ],
      textResponse('described image accepted'),
    ])
    type RequestMessages = Parameters<MockAdapter['stream']>[0]['messages']
    const project = (messages: RequestMessages): RequestMessages => messages.map(message => ({
      ...message,
      content: message.content.map(block => block.type === 'image'
        ? { type: 'text' as const, text: 'fallback image description' }
        : block),
    }))
    let fallbackApplied = false
    const rewriteMessages = vi.fn(async (
      _session: unknown,
      _route: unknown,
      messages: RequestMessages,
      _signal: AbortSignal,
      force = false,
    ) => {
      if (!force) return messages
      fallbackApplied = true
      return project(messages)
    })
    const reconstructMessages = (_session: unknown, messages: RequestMessages): RequestMessages =>
      fallbackApplied ? project(messages) : messages
    const ctx = await harness(adapter, { rewriteMessages, reconstructMessages })
    let unexpectedFailure: LlmFailure | undefined
    let unexpectedAgentError: unknown
    ctx.on('agent/request-error', async ({ failure }) => { unexpectedFailure = failure })
    ctx.on('agent/error', ({ error }) => { unexpectedAgentError = error })
    const agent = ctx.agentLoop.create(SessionId('request-error-vision-fallback'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({
      content: [{
        type: 'image',
        attachment: {
          attachmentId: 'image-1' as never,
          mediaType: 'image/png',
          bytes: 1,
          width: 1,
          height: 1,
        },
      }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()

    expect(rewriteMessages).toHaveBeenCalledTimes(2)
    expect(unexpectedFailure).toBeUndefined()
    expect(unexpectedAgentError).toBeUndefined()
    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests[0]?.messages[0]?.content[0]).toMatchObject({ type: 'image' })
    expect(adapter.requests[1]?.messages[0]?.content[0]).toEqual({
      type: 'text', text: 'fallback image description',
    })
    expect(rewriteMessages).toHaveBeenLastCalledWith(
      expect.anything(),
      { provider: 'mock', model: 'mock' },
      expect.anything(),
      expect.any(AbortSignal),
      true,
    )
  })

  it('does not offer middleware failures to request recovery', async () => {
    const adapter = new MockAdapter([textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('request-error-narrow'), { provider: 'mock', model: 'mock' })
    let recoveries = 0
    ctx.on('agent/request', () => {
      throw new LlmError('middleware failed', 'MIDDLEWARE')
    })
    ctx.on('agent/request-error', async () => {
      recoveries += 1
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(recoveries).toBe(0)
    expect(adapter.requests).toHaveLength(0)
  })

  it('lets each failed request return a retry action before its turn closes', async () => {
    const adapter = new MockAdapter([
      fail('busy', 'RATE_LIMIT'),
      fail('unavailable', 'SERVICE_UNAVAILABLE'),
      textResponse('ok'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('request-error-retry'), { provider: 'mock', model: 'mock' })
    const seen: {
      turn: number
      step: number
      failure: LlmFailure
      retryPolicy: ResolvedRetryPolicy | undefined
    }[] = []
    const statuses: string[] = []
    ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent) statuses.push(status)
    })
    ctx.on('agent/request-error', async ({ agent: subject, turn, step, failure, retryPolicy }) => {
      expect(subject).toBe(agent)
      seen.push({ turn, step, failure, retryPolicy })
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(seen.map(item => ({
      turn: item.turn,
      step: item.step,
      code: item.failure.code,
    }))).toEqual([
      {
        turn: 1,
        step: 1,
        code: 'RATE_LIMIT',
      },
      {
        turn: 1,
        step: 1,
        code: 'SERVICE_UNAVAILABLE',
      },
    ])
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(seen.map(item => item.retryPolicy)).toEqual([
      expect.objectContaining({ mode: 'normal' }),
      expect.objectContaining({ mode: 'normal' }),
    ])
    expect(statuses).toEqual(['running', 'idle'])
  })

  it('lets cancellation win over a retry action', async () => {
    const adapter = new MockAdapter([fail('busy', 'RATE_LIMIT'), textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('request-error-cancel'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/request-error', async ({ agent: subject }) => {
      subject.cancel({ kind: 'user' })
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(agent.session.events.find(event => event.type === 'turn/end')).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'aborted', reason: { kind: 'user' } } },
    })
  })

  it('does not retry when the recovery listener fails before returning its action', async () => {
    const adapter = new MockAdapter([fail('busy', 'RATE_LIMIT'), textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('request-error-recovery-failed'), {
      provider: 'mock',
      model: 'mock',
    })
    ctx.on('agent/request-error', async () => {
      throw new Error('recovery failed')
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(agent.session.events.find(event => event.type === 'turn/end')).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'error' } },
    })
  })
})
