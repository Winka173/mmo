import GameForm from "../../components/GameForm";
import Msg from "../../components/Msg";

export default async function NewGame({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Tạo game mới</h1>
      <Msg msg={sp.msg} />
      <GameForm game={null} kit={null} accounts={[]} />
    </div>
  );
}
