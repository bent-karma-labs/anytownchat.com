"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

type Profile = {
  id: string;
  display_name: string | null;
  avatar_color: string;
  gender: string | null;
};

type Post = {
  id: string;
  title: string | null;
  body: string;
  category: string;
  created_at: string;
  community_id: string;
  author_id: string;
};

type Comment = {
  id: string;
  post_id: string;
  body: string;
  created_at: string;
  author_id: string;
};

type Reaction = {
  id: string;
  post_id: string;
  kind: string;
  user_id: string;
};

type ChatMessage = {
  id: string;
  community_id: string;
  author_id: string;
  body: string;
  created_at: string;
};

const avatarColors = [
  ["slate", "bg-slate-500"],
  ["blue", "bg-blue-500"],
  ["violet", "bg-violet-500"],
  ["pink", "bg-pink-500"],
  ["orange", "bg-orange-500"],
  ["green", "bg-green-500"],
  ["cyan", "bg-cyan-500"],
];

export default function Community() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [sendingChat, setSendingChat] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [zip, setZip] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("chat");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [displayName, setDisplayName] = useState("");
  const [gender, setGender] = useState("na");
  const [avatarColor, setAvatarColor] = useState("blue");
  const [savingProfile, setSavingProfile] = useState(false);
  const [status, setStatus] = useState("Loading…");
  const [communityId, setCommunityId] = useState<string | null>(null);
  const client = useMemo(() => supabase(), []);

  useEffect(() => {
    let postChannel: ReturnType<typeof client.channel> | null = null;
    let commentChannel: ReturnType<typeof client.channel> | null = null;
    let chatChannel: ReturnType<typeof client.channel> | null = null;

    async function start() {
      const currentZip = localStorage.getItem("anytown_zip") || "";
      setZip(currentZip);

      const {
        data: { user },
      } = await client.auth.getUser();

      if (!user) {
        setStatus("Your session expired. Go back and enter your town again.");
        return;
      }

      const { data: currentProfile, error: profileError } = await client
        .from("profiles")
        .select("id,display_name,avatar_color,gender")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) {
        setStatus(profileError.message);
        return;
      }

      if (currentProfile) {
        const p = currentProfile as Profile;
        setProfile(p);
        setDisplayName(p.display_name || "");
        setGender(p.gender || "na");
        setAvatarColor(p.avatar_color || "blue");
      }

      if (!currentZip) {
        setStatus("Enter your ZIP first.");
        return;
      }

      const { data: joinedCommunityId, error: joinError } = await client.rpc(
        "join_or_create_community",
        { p_zip: currentZip },
      );

      if (joinError) {
        setStatus(joinError.message);
        return;
      }

      const { data: community, error: communityError } = await client
        .from("communities")
        .select("id,name")
        .eq("id", joinedCommunityId)
        .maybeSingle();

      if (communityError || !community) {
        setStatus(communityError?.message || "Community not found yet.");
        return;
      }

      setCommunityId(community.id);

      const { data: loadedPosts, error: postsError } = await client
        .from("posts")
        .select("id,title,body,category,created_at,community_id,author_id")
        .eq("community_id", community.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (postsError) {
        setStatus(postsError.message);
        return;
      }

      const nextPosts = (loadedPosts || []) as Post[];
      setPosts(nextPosts);

      const { data: loadedChat } = await client
        .from("chat_messages")
        .select("id,community_id,author_id,body,created_at")
        .eq("community_id", community.id)
        .order("created_at", { ascending: true })
        .limit(100);

      const nextChat = (loadedChat || []) as ChatMessage[];
      setChatMessages(nextChat);

      if (nextPosts.length || nextChat.length) {
        const ids = nextPosts.map((p) => p.id);
        const authorIds = [
          ...new Set([
            ...nextPosts.map((p) => p.author_id),
            ...nextChat.map((message) => message.author_id),
          ]),
        ];

        const [{ data: loadedComments }, { data: loadedReactions }, { data: loadedProfiles }] =
          await Promise.all([
            client
              .from("comments")
              .select("id,post_id,body,created_at,author_id")
              .in("post_id", ids)
              .order("created_at", { ascending: true }),
            client
              .from("reactions")
              .select("id,post_id,kind,user_id")
              .in("post_id", ids),
            client
              .from("profiles")
              .select("id,display_name,avatar_color,gender")
              .in("id", authorIds),
          ]);

        setComments(groupByPost((loadedComments || []) as Comment[]));
        setReactions(groupByPost((loadedReactions || []) as Reaction[]));
        setProfiles(
          Object.fromEntries(
            ((loadedProfiles || []) as Profile[]).map((p) => [p.id, p]),
          ),
        );
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
            filter: "community_id=eq." + community.id,
          },
          (event) => {
            const incoming = event.new as Post;
            setPosts((current) =>
              current.some((p) => p.id === incoming.id) ? current : [incoming, ...current],
            );
          },
        )
        .subscribe();

      chatChannel = client
        .channel("live-town-chat")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "chat_messages",
            filter: "community_id=eq." + community.id,
          },
          async (event) => {
            const incoming = event.new as ChatMessage;
            setChatMessages((current) =>
              current.some((message) => message.id === incoming.id)
                ? current
                : [...current, incoming],
            );

            if (!profiles[incoming.author_id]) {
              const { data: author } = await client
                .from("profiles")
                .select("id,display_name,avatar_color,gender")
                .eq("id", incoming.author_id)
                .maybeSingle();

              if (author) {
                setProfiles((current) => ({
                  ...current,
                  [incoming.author_id]: author as Profile,
                }));
              }
            }
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
      if (chatChannel) client.removeChannel(chatChannel);
    };
  }, [client]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    const name = displayName.trim();

    if (name.length < 2 || name.length > 30) {
      setStatus("Pick a name between 2 and 30 characters.");
      return;
    }

    setSavingProfile(true);

    const {
      data: { user },
    } = await client.auth.getUser();

    if (!user) {
      setSavingProfile(false);
      setStatus("Your session expired. Go back and enter your town again.");
      return;
    }

    const { data: saved, error } = await client
      .from("profiles")
      .update({
        display_name: name,
        gender,
        avatar_color: avatarColor,
      })
      .eq("id", user.id)
      .select("id,display_name,avatar_color,gender")
      .single();

    setSavingProfile(false);

    if (error) {
      setStatus(error.message);
      return;
    }

    setProfile(saved as Profile);
    setProfiles((current) => ({ ...current, [user.id]: saved as Profile }));
    setStatus("You're in.");
  }

  async function sendChat(event: FormEvent) {
    event.preventDefault();
    const trimmed = chatDraft.trim();

    if (!trimmed || sendingChat) return;

    if (!profile?.display_name) {
      setStatus("Choose your name first.");
      return;
    }

    const {
      data: { user },
    } = await client.auth.getUser();

    if (!user || !communityId) {
      setStatus("Your session expired or the town is still loading.");
      return;
    }

    setSendingChat(true);

    const { data: created, error } = await client
      .from("chat_messages")
      .insert({
        community_id: communityId,
        author_id: user.id,
        body: trimmed,
      })
      .select("id,community_id,author_id,body,created_at")
      .single();

    setSendingChat(false);

    if (error) {
      setStatus(error.message);
      return;
    }

    setChatMessages((current) =>
      current.some((message) => message.id === created.id)
        ? current
        : [...current, created as ChatMessage],
    );
    setChatDraft("");
    setStatus("Live");
  }

  async function post(event: FormEvent) {
    event.preventDefault();
    const trimmedBody = body.trim();
    if (!trimmedBody) return;

    if (!profile?.display_name) {
      setStatus("Choose your name first.");
      return;
    }

    const {
      data: { user },
    } = await client.auth.getUser();

    if (!user) {
      setStatus("Your session expired. Go back and enter your town again.");
      return;
    }

    if (!communityId) {
      setStatus("Community is still loading.");
      return;
    }

    const { data: created, error } = await client
      .from("posts")
      .insert({
        community_id: communityId,
        author_id: user.id,
        title: title.trim() || null,
        body: trimmedBody,
        category,
      })
      .select("id,title,body,category,created_at,community_id,author_id")
      .single();

    if (error) {
      setStatus(error.message);
      return;
    }

    setPosts((current) => [created as Post, ...current]);
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
      setStatus("Your session expired.");
      return;
    }

    const { data: created, error } = await client
      .from("comments")
      .insert({
        post_id: postId,
        author_id: user.id,
        body: draft,
      })
      .select("id,post_id,body,created_at,author_id")
      .single();

    if (error) {
      setStatus(error.message);
      return;
    }

    setComments((current) => ({
      ...current,
      [postId]: [...(current[postId] || []), created as Comment],
    }));
    setCommentDrafts((current) => ({ ...current, [postId]: "" }));
  }

  async function react(postId: string) {
    const {
      data: { user },
    } = await client.auth.getUser();

    if (!user) return;

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
      else {
        setReactions((current) => ({
          ...current,
          [postId]: (current[postId] || []).filter((r) => r.id !== existing.id),
        }));
      }
      return;
    }

    const { data: created, error } = await client
      .from("reactions")
      .insert({ post_id: postId, user_id: user.id, kind: "like" })
      .select("id,post_id,kind,user_id")
      .single();

    if (error) setStatus(error.message);
    else {
      setReactions((current) => ({
        ...current,
        [postId]: [...(current[postId] || []), created as Reaction],
      }));
    }
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages.length]);

  const initials = (profile?.display_name || "?").slice(0, 1).toUpperCase();
  const currentColor = avatarColors.find(([key]) => key === (profile?.avatar_color || avatarColor))?.[1] || "bg-blue-500";

  return (
    <main className="min-h-screen px-5 py-8">
      <div className="mx-auto max-w-4xl">
        <header className="flex items-center justify-between">
          <a href="/" className="font-bold">Anytown Chat</a>
          <span className="text-sm text-zinc-500">{status}</span>
        </header>

        {!profile?.display_name ? (
          <section className="mx-auto mt-16 max-w-lg rounded-3xl border border-white/10 bg-white/[.04] p-7">
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-[.2em] text-zinc-500">WELCOME TO ANYTOWN</p>
              <h1 className="mt-2 text-3xl font-black">What should people call you?</h1>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                Pick a display name and a little avatar style. You can change these later.
              </p>
            </div>

            <form onSubmit={saveProfile}>
              <label className="block text-sm text-zinc-400">
                Display name
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value.slice(0, 30))}
                  placeholder="Townie"
                  autoFocus
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-white/30"
                />
              </label>

              <label className="mt-5 block text-sm text-zinc-400">
                Gender
                <select
                  value={gender}
                  onChange={(event) => setGender(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3"
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="na">N/A</option>
                </select>
              </label>

              <div className="mt-5">
                <p className="text-sm text-zinc-400">Avatar color</p>
                <div className="mt-3 flex flex-wrap gap-3">
                  {avatarColors.map(([key, color]) => (
                    <button
                      key={key}
                      type="button"
                      aria-label={key}
                      onClick={() => setAvatarColor(key)}
                      className={`h-10 w-10 rounded-full ${color} ${avatarColor === key ? "ring-2 ring-white ring-offset-2 ring-offset-black" : ""}`}
                    />
                  ))}
                </div>
              </div>

              <button
                disabled={savingProfile}
                className="mt-7 w-full rounded-xl bg-white px-4 py-3 font-bold text-black disabled:opacity-50"
              >
                {savingProfile ? "Saving…" : "Enter the town →"}
              </button>
            </form>
          </section>
        ) : (
          <>
            <div className="mt-10 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.2em] text-zinc-500">LIVE LOCAL</p>
                <h1 className="mt-2 text-4xl font-black">{zip || "Community"}</h1>
              </div>
              <div className="flex items-center gap-2">
                <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white ${currentColor}`}>
                  {initials}
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-500">
                  {profile.display_name}
                </span>
              </div>
            </div>

            <section className="mt-8 overflow-hidden rounded-3xl border border-white/10 bg-white/[.035] shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />
                    <h2 className="text-lg font-bold">Town Chat</h2>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    The live conversation for everyone in {zip || "your town"}.
                  </p>
                </div>
                <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-500">
                  LIVE
                </span>
              </div>

              <div className="h-[360px] overflow-y-auto px-4 py-4">
                {chatMessages.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-center text-sm text-zinc-600">
                    <div>
                      <p className="text-zinc-400">Nobody is talking yet.</p>
                      <p className="mt-1">Say hello and start the town conversation.</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {chatMessages.map((message) => {
                      const author = profiles[message.author_id];
                      const mine = message.author_id === profile.id;

                      return (
                        <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[82%] ${mine ? "items-end" : "items-start"}`}>
                            <div className="mb-1 flex items-center gap-2 px-1">
                              <span className="text-xs font-semibold text-zinc-400">
                                {author?.display_name || "Townie"}
                              </span>
                              <time className="text-[10px] text-zinc-700">
                                {new Date(message.created_at).toLocaleTimeString([], {
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </time>
                            </div>
                            <div
                              className={`rounded-2xl px-4 py-2.5 text-sm leading-6 ${
                                mine
                                  ? "rounded-br-md bg-white text-black"
                                  : "rounded-bl-md bg-white/[.07] text-zinc-200"
                              }`}
                            >
                              {message.body}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={chatEndRef} />
                  </div>
                )}
              </div>

              <form onSubmit={sendChat} className="border-t border-white/10 bg-black/20 p-3">
                <div className="flex gap-2">
                  <input
                    value={chatDraft}
                    onChange={(event) => setChatDraft(event.target.value.slice(0, 1000))}
                    placeholder="Talk to your town…"
                    maxLength={1000}
                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-white/30"
                  />
                  <button
                    disabled={sendingChat || !chatDraft.trim()}
                    className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {sendingChat ? "Sending…" : "Send"}
                  </button>
                </div>
                <p className="mt-2 px-1 text-[11px] text-zinc-700">
                  Press Enter to send • Everyone in this town can see the chat
                </p>
              </form>
            </section>

            <form onSubmit={post} className="mt-8 rounded-2xl border border-white/10 bg-white/[.04] p-5">
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
              <button className="mt-3 rounded-lg bg-white px-5 py-2 font-bold text-black">Post</button>
            </form>

            <section className="mt-8 space-y-4">
              {posts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-zinc-500">
                  Your town is quiet. Start the first conversation.
                </div>
              ) : null}

              {posts.map((post) => {
                const postComments = comments[post.id] || [];
                const postReactions = reactions[post.id] || [];
                const author = profiles[post.author_id];

                return (
                  <article key={post.id} className="rounded-2xl border border-white/10 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-bold">
                          {(author?.display_name || "T").slice(0, 1).toUpperCase()}
                        </span>
                        <span className="text-sm font-semibold">{author?.display_name || "Townie"}</span>
                        <span className="text-xs uppercase tracking-wide text-zinc-600">
                          {post.category.replace("_", " ")}
                        </span>
                      </div>
                      <time className="text-xs text-zinc-600">{new Date(post.created_at).toLocaleString()}</time>
                    </div>

                    {post.title ? <h2 className="mt-3 text-xl font-bold">{post.title}</h2> : null}
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
                        {postComments.slice(-5).map((comment) => {
                          const commentAuthor = profiles[comment.author_id];
                          return (
                            <div key={comment.id} className="text-sm text-zinc-400">
                              <span className="font-semibold text-zinc-300">{commentAuthor?.display_name || "Townie"}:</span>{" "}
                              {comment.body}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    <div className="mt-4 flex gap-2">
                      <input
                        value={commentDrafts[post.id] || ""}
                        onChange={(event) =>
                          setCommentDrafts((current) => ({ ...current, [post.id]: event.target.value }))
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
          </>
        )}
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
