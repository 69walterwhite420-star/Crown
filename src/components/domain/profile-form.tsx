"use client";

import { useEffect, useRef, useState } from "react";
import {
  inputsFromLinks,
  LinkEditor,
  type LinkInputs,
  linksFromInputs,
} from "@/components/domain/link-editor";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useProfile, useSession, useUpdateProfile } from "@/lib/data/hooks";

/**
 * Редактор профиля (публичная личность): имя, аватар (URL), «о себе», соц-ссылки. Самодостаточен —
 * тянет свою сессию/профиль. Используется в /me/profile и в личном пространстве (Settings).
 */
export function ProfileForm() {
  const address = useSession().data?.address ?? null;
  const profileQ = useProfile(address);
  const update = useUpdateProfile();

  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bio, setBio] = useState("");
  const [linkInputs, setLinkInputs] = useState<LinkInputs>([]);

  // Заполняем форму ОДИН раз на адрес: фоновый рефетч (напр. инвалидация после save) не должен затирать
  // несохранённые правки. Смена адреса (другой кошелёк) → пере-гидрация.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    const p = profileQ.data;
    if (p && hydratedFor.current !== address) {
      hydratedFor.current = address;
      setDisplayName(p.displayName ?? "");
      setAvatarUrl(p.avatarUrl ?? "");
      setBio(p.bio ?? "");
      setLinkInputs(inputsFromLinks(p.links));
    }
  }, [profileQ.data, address]);

  if (!address) return null; // вход гейтит вызывающая страница
  if (profileQ.isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;

  function save() {
    update.mutate(
      {
        displayName: displayName.trim() || undefined,
        avatarUrl: avatarUrl.trim() || undefined,
        bio: bio.trim() || undefined,
        links: linksFromInputs(linkInputs),
      },
      {
        onSuccess: () => toast({ variant: "success", title: "Profile saved" }),
        onError: (e) => toast({ variant: "error", title: "Error", description: String(e) }),
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Input
        label="Name (display name)"
        maxLength={40}
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
      />
      <Input
        label="Avatar (image link)"
        mono
        placeholder="https://…"
        value={avatarUrl}
        onChange={(e) => setAvatarUrl(e.target.value)}
      />
      <Textarea
        label="About"
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        maxLength={280}
        showCount
      />
      <div className="flex flex-col gap-2">
        <span className="text-small text-fg-muted">Links</span>
        <LinkEditor value={linkInputs} onChange={setLinkInputs} />
      </div>
      <Button onClick={save} loading={update.isPending} className="w-fit">
        Save profile
      </Button>
    </div>
  );
}
