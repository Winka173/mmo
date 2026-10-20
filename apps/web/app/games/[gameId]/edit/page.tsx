import { BrandIdentityEngine } from "@ttm/media";
import { notFound } from "next/navigation";
import GameForm from "../../../components/GameForm";
import Msg from "../../../components/Msg";
import { getAccounts, getGames, getStore } from "../../../lib/data";

export const dynamic = "force-dynamic";

export default async function EditGame({ params, searchParams }: { params: Promise<{ gameId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { gameId } = await params;
  const sp = await searchParams;
  const game = await (await getGames()).get(gameId);
  if (!game) notFound();
  const kit = await new BrandIdentityEngine(await getStore()).load({ kind: "game", id: game.gameId });
  const accounts = (await (await getAccounts()).list()).filter((a) => a.owner.kind === "game" && a.owner.id === game.gameId);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Sửa game: {game.publicTitle}</h1>
      <Msg msg={sp.msg} />
      <GameForm game={game} kit={kit} accounts={accounts} />
    </div>
  );
}
