"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

type Post = {
  id: string;
  title: string | null;
  body: string;
  category: string;
  created_at: string;
  community_id: string;
};

type Comment = {
  id: string;
  post_id: string;
  body: string;
  created_at: string;
};

type Reaction = {
  id: string;
  post_id: string;
  kind: string;
};

export default function Community() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
  const [zip, setZip] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("chat");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("Loading…");
  const [communityId, setCommunityId] = useState<string | null>(null);
  const client = useMemo(() => supabase(), []);

  useEffect(() => {
    let postChannel: ReturnType<typeof client.channel> | null = null;
    let commentChannel: ReturnType<typeof client.channel> | null = null;

    async function start() {
      const currentZip = localStorage.getItem("anytown_zip") || "";
      setZip(currentZip);

      if (!currentZip) {
        setStatus("Enter your ZIP first.");
        return;
      }

      const { error: joinError } = await client.rpc("join_or_create_community", {
        p_zip: currentZip,
      });
      if (joinError) {
        setStatus(joinError.message);
        return;
      }

      const { data: community, error: communityError } = await client
        .from("communities")
        .select("id,name")
        .eq("zip_code", currentZip)
        .maybeSingle();

      if (communityError || !community) {
        setStatus(communityError?.message || "Community not found yet.");
        return;
      }

      setCommunityId(community.id);

      const { data: loadedPosts, error: postsError } = await client
        .from("posts")
        .select("id,title,body,category,created_at,community_id")
        .eq("community_id", community.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (postsError) {
        setStatus(postsError.message);
        return;
      }

      const nextPosts = (loadedPosts || []) as Post[];
      setPosts(nextPosts);

      if (nextPosts.length) {
        const ids = nextPosts.map((p) => p.id);
        const [{ data: loadedComments }, { data: loadedReactions }] = await Promise.all([
          client
            .from("comments")
            .select("id,post_id,body,created_at")
            .in("post_id", ids)
            .order("created_at", { ascending: true }),
          client
            .from("reactions")
            .select("id,post_id,kind")
            .in("post_id", ids),
        ]);

        setComments(groupByPost((loadedComments || []) as Comment[]));
        setReactions(groupByPost((loadedReactions || []) as Reaction[]));
      }

      setStatus(community.name || "Your community");

      postChannel = client
        .channel("live-posts")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "posts",
            filter: `community_id=eq.${community.id}`,
          },
          (event) => {
            const incoming = event.new as Post;
            setPosts((current) =>
              current.some((p) => p.id === incoming.id) ? current : [incoming, ...current],
            );
          },
        )
        .subscribe();

      commentChannel = client
        .channel("live-comments")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "comments" },
          (event) => {
            const incoming = event.new as Comment;
            setComments((current) => ({
              ...current,
              [incoming.post_id]: [...(current[incoming.post_id] || []), incoming],
            }));
          },
        )
        .subscribe();
    }

    start();

    return () => {
      if (postChannel) client.removeChannel(postChannel);
      if (commentChannel) client.removeChannel(commentChannel);
    };
  }, [client]);

  async function post(event: FormEvent) {
    event.preventDefault();
    const trimmedBody = body.trim();
    if (!trimmedBody) return;

    const {
      data: { user },
    } = await client.auth.getUser();

    if (!user) {
      setStatus("Sign in first.");
      return;
    }

    if (!communityId) {
      setStatus("Community is still loading.");
      return;
    }

    const { error } = await client.from("posts").insert({
      community_id: communityId,
      author_id: user.id,
      title: title.trim() || null,
      body: trimmedBody,
      category,
    });

    if (error) {
      setStatus(error.message);
      return;
    }

    setTitle("");
    setBody("");
    setStatus("Posted.");
  }

  async function addComment(postId: string) {
    const draft = (commentDrafts[postId] || "").trim();
    if (!draft) return;

    const {
      data: { user },
    } = await client.auth.getUser();

    if (!user) {
      setStatus("Sign in first.");
      return;
    }

    const { error } = await client.from("comments").insert({
      post_id: postId,
      author_id: user.id,
      body: draft,
    });

    if (error) {
      setStatus(error.message);
      return;
    }

    setCommentDrafts((current) => ({ ...current, [postId]: "" }));
  }

  async function react(postId: string) {
    const {
      data: { user },
    } = await client.auth.getUser();

    if (!user) {
      setStatus("Sign in first.");
      return;
    }

    const { data: existing } = await client
      .from("reactions")
      .select("id")
      .eq("post_id", postId)
      .eq("user_id", user.id)
      .eq("kind", "like")
      .maybeSingle();

    if (existing) {
      const { error } = await client.from("reactions").delete().eq("id", existing.id);
      if (error) setStatus(error.message);
      return;
    }

    const { error } = await client.from("reactions").insert({
      post_id: postId,
      user_id: user.id,
      kind: "like",
    });

    if (error) setStatus(error.message);
  }

  return (
    <main className="min-h-screen px-5 py-8">
      <div className="mx-auto max-w-4xl">
        <header className="flex items-center justify-between">
          <a href="/" className="font-bold">
            Anytown Chat
          </a>
          <span className="text-sm text-zinc-500">{status}</span>
        </header>

        <div className="mt-10 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.2em] text-zinc-500">
              LIVE LOCAL
            </p>
            <h1 className="mt-2 text-4xl font-black">{zip || "Community"}</h1>
          </div>
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-500">
            ZIP community
          </span>
        </div>

        <form
          onSubmit={post}
          className="mt-8 rounded-2xl border border-white/10 bg-white/[.04] p-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row">
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="rounded-lg bg-black px-3 py-2"
            >
              <option value="chat">Chat</option>
              <option value="news">News</option>
              <option value="event">Event</option>
              <option value="help">Help</option>
              <option value="buy_sell">Buy / Sell</option>
              <option value="business">Business</option>
            </select>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What’s happening?"
              className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2"
            />
          </div>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            required
            placeholder="Say something your town should know…"
            className="mt-3 min-h-28 w-full rounded-lg border border-white/10 bg-black/30 p-3"
          />
          <button className="mt-3 rounded-lg bg-white px-5 py-2 font-bold text-black">
            Post
          </button>
        </form>

        <section className="mt-8 space-y-4">
          {posts.length === 0 && communityId ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-zinc-500">
              Your town is quiet. Start the first conversation.
            </div>
          ) : null}

          {posts.map((post) => {
            const postComments = comments[post.id] || [];
            const postReactions = reactions[post.id] || [];

            return (
              <article key={post.id} className="rounded-2xl border border-white/10 p-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs uppercase tracking-wide text-zinc-500">
                    {post.category.replace("_", " ")}
                  </span>
                  <time className="text-xs text-zinc-600">
                    {new Date(post.created_at).toLocaleString()}
                  </time>
                </div>

                {post.title ? <h2 className="mt-2 text-xl font-bold">{post.title}</h2> : null}
                <p className="mt-2 whitespace-pre-wrap text-zinc-300">{post.body}</p>

                <div className="mt-5 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => react(post.id)}
                    className="rounded-full border border-white/10 px-3 py-1 text-sm hover:bg-white/5"
                  >
                    👍 {postReactions.length}
                  </button>
                  <span className="text-sm text-zinc-600">
                    {postComments.length} {postComments.length === 1 ? "comment" : "comments"}
                  </span>
                </div>

                {postComments.length ? (
                  <div className="mt-4 space-y-2 border-l border-white/10 pl-4">
                    {postComments.slice(-5).map((comment) => (
                      <div key={comment.id} className="text-sm text-zinc-400">
                        {comment.body}
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="mt-4 flex gap-2">
                  <input
                    value={commentDrafts[post.id] || ""}
                    onChange={(event) =>
                      setCommentDrafts((current) => ({
                        ...current,
                        [post.id]: event.target.value,
                      }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        addComment(post.id);
                      }
                    }}
                    placeholder="Reply to your town…"
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => addComment(post.id)}
                    className="rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/5"
                  >
                    Reply
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}

function groupByPost<T extends { post_id: string }>(items: T[]) {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    (groups[item.post_id] ||= []).push(item);
    return groups;
  }, {});
}
