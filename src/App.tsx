/* global __DEV__ */

import { useState, useEffect, useRef, useCallback } from 'react'
import { reloadAppAsync } from 'expo-modules-core'
import { StatusBar } from 'expo-status-bar'
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import PearRuntime from 'pear-mobile'

import FramedStream from 'framed-stream'
import b4a from 'b4a'
import bundle from './worker.bundle.js'
import { type ChatLine, chatSendPayload, parseWorkerChatEvent } from './chat'
import { version, upgrade, name, productName } from '../package.json'

const appName = productName ?? name

let lineId = 0
function nextLineId() {
  lineId += 1
  return String(lineId)
}

export default function App() {
  const [peerCount, setPeerCount] = useState(0)
  const [lines, setLines] = useState<ChatLine[]>([])
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [applyUpdate, setApplyUpdate] = useState<(() => void) | null>(null)
  const shouldReload = useRef(false)
  const pipeRef = useRef<FramedStream | null>(null)
  const listRef = useRef<FlatList<ChatLine>>(null)

  const appendLine = useCallback((from: string, text: string) => {
    setLines((prev) => [...prev, { id: nextLineId(), from, text }])
  }, [])

  useEffect(() => {
    const IPC = PearRuntime.run('/worker.bundle', bundle, [
      (!__DEV__).toString(),
      version,
      upgrade,
      appName
    ])
    const pipe = new FramedStream(IPC)
    pipeRef.current = pipe

    setApplyUpdate(() => () => pipe.write('pear:applyUpdate'))

    pipe.on('data', (data) => {
      const parsed = b4a.toString(data)

      const chatEvent = parseWorkerChatEvent(parsed)
      if (chatEvent) {
        if (chatEvent.type === 'peers') setPeerCount(chatEvent.count)
        else if (chatEvent.type === 'ready') appendLine('system', 'connected to swarm')
        else if (chatEvent.type === 'message') appendLine(chatEvent.from, chatEvent.text)
        return
      }

      if (parsed === 'updating') {
        setStatus('updating')
        return
      }

      if (parsed === 'updated') {
        setStatus('updated')
        return
      }

      if (parsed === 'minver-required') {
        setStatus('incompatible')
        return
      }

      if (parsed.startsWith('pear:updateFailed')) {
        shouldReload.current = false
        setError(parsed.slice('pear:updateFailed '.length) || 'Update failed')
        setStatus('failed')
        return
      }

      if (parsed === 'pear:updateApplied') {
        if (shouldReload.current) {
          reloadAppAsync('Pear update applied').catch((err) => {
            setError(`Reload failed: ${err instanceof Error ? err.message : String(err)}`)
            setStatus('failed')
          })
          return
        }

        setStatus('')
        return
      }
    })

    pipe.on('error', (err) => console.error(err))

    return () => {
      pipeRef.current = null
      pipe.destroy()
    }
  }, [appendLine])

  useEffect(() => {
    if (lines.length === 0) return
    listRef.current?.scrollToEnd({ animated: true })
  }, [lines.length])

  const sendMessage = () => {
    const text = draft.trim()
    if (!text || !pipeRef.current) return
    setDraft('')
    appendLine('you', text)
    pipeRef.current.write(chatSendPayload(text))
  }

  const updateBanner =
    status === 'updating'
      ? 'Updating…'
      : status === 'updated' || status === 'applying'
        ? 'Update ready'
        : status === 'incompatible'
          ? `Update on ${Platform.OS === 'ios' ? 'App Store' : 'Play Store'}`
          : status === 'failed'
            ? error
            : null

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
    >
      <StatusBar style='light' />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Pear chat</Text>
        <View style={styles.headerMeta}>
          <View style={styles.peerDot} />
          <Text style={styles.peerLabel}>
            peers: <Text style={styles.peerCount}>{peerCount}</Text>
          </Text>
          <Text style={styles.version}>v{version}</Text>
        </View>
      </View>

      {updateBanner !== null && (
        <View style={styles.updateBar}>
          <Text style={styles.updateBarText}>{updateBanner}</Text>
          {(status === 'updated' || status === 'applying') && (
            <Pressable
              disabled={status === 'applying' || !applyUpdate}
              onPress={() => {
                setStatus('applying')
                try {
                  shouldReload.current = true
                  applyUpdate?.()
                } catch (err) {
                  shouldReload.current = false
                  setError(`Update failed: ${err instanceof Error ? err.message : String(err)}`)
                  setStatus('failed')
                }
              }}
              style={({ pressed }) => [styles.applyBtn, pressed && styles.applyBtnPressed]}
            >
              <Text style={styles.applyBtnText}>
                {status === 'applying' ? 'Applying…' : 'Apply'}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      <FlatList
        ref={listRef}
        contentContainerStyle={styles.logContent}
        data={lines}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.logRow}>
            <Text
              style={[
                styles.logFrom,
                item.from === 'system' && styles.fromSystem,
                item.from === 'you' && styles.fromYou,
                item.from !== 'system' && item.from !== 'you' && styles.fromPeer
              ]}
            >
              {item.from}:
            </Text>
            <Text style={styles.logText}>{item.text}</Text>
          </View>
        )}
        style={styles.log}
      />

      <View style={styles.footer}>
        <TextInput
          onChangeText={setDraft}
          onSubmitEditing={sendMessage}
          placeholder='type and press enter'
          placeholderTextColor='#71717a'
          returnKeyType='send'
          style={styles.input}
          value={draft}
        />
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#09090b'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#27272a',
    backgroundColor: 'rgba(24, 24, 27, 0.6)',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 56 : 16,
    paddingBottom: 12
  },
  headerTitle: {
    color: '#fafafa',
    fontSize: 14,
    fontWeight: '600'
  },
  headerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  peerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981'
  },
  peerLabel: {
    color: '#a1a1aa',
    fontSize: 12
  },
  peerCount: {
    color: '#fafafa',
    fontWeight: '500'
  },
  version: {
    color: '#71717a',
    fontSize: 11,
    marginLeft: 4
  },
  updateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: '#14532d',
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  updateBarText: {
    color: '#ecfdf5',
    fontSize: 13,
    flex: 1
  },
  applyBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#fafafa'
  },
  applyBtnPressed: {
    opacity: 0.85
  },
  applyBtnText: {
    color: '#fafafa',
    fontSize: 13,
    fontWeight: '600'
  },
  log: {
    flex: 1
  },
  logContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4
  },
  logRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4
  },
  logFrom: {
    fontSize: 14,
    fontWeight: '500'
  },
  fromSystem: {
    color: '#71717a',
    fontStyle: 'italic'
  },
  fromYou: {
    color: '#34d399'
  },
  fromPeer: {
    color: '#38bdf8'
  },
  logText: {
    color: '#fafafa',
    fontSize: 14,
    flexShrink: 1
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#27272a',
    backgroundColor: 'rgba(24, 24, 27, 0.6)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 12
  },
  input: {
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 8,
    backgroundColor: '#18181b',
    color: '#fafafa',
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10
  }
})
