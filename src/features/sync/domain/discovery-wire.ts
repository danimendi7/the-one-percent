import type { OwnTopic, TopicFeedback } from "@/features/discover/domain/types"
import type { WireDiscoveryTopic, WireTopicFeedback } from "./types"

export function toOwnTopic(w: WireDiscoveryTopic): OwnTopic {
  return { id: w.id, title: w.title, category: w.category, body: w.body, sourceTitle: w.source_title, sourceUrl: w.source_url, createdAt: w.created_at }
}

export function toTopicFeedback(w: WireTopicFeedback): TopicFeedback {
  return { topicKey: w.topic_key, rating: w.rating, saved: w.saved, dismissed: w.dismissed, decidedOn: w.decided_on, updatedAt: w.updated_at }
}
