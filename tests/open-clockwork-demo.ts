import { assert } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { OpenClockworkDemo } from "../target/types/open_clockwork_demo";
const { LAMPORTS_PER_SOL, PublicKey, SystemProgram, } = anchor.web3;
import { ClockworkProvider } from "@clockwork-xyz/sdk";

describe("open-clockwork-demo", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.OpenClockworkDemo as Program<OpenClockworkDemo>;

  const { connection } = program.provider;
  const provider = anchor.AnchorProvider.local();
  const payer = provider.wallet.publicKey;
  anchor.setProvider(provider);
  const clockworkProvider = ClockworkProvider.fromAnchorProvider(provider);

  console.log("Initiating tests for program:", program.programId.toBase58());
  console.log(`https://explorer.solana.com/address/${program.programId.toBase58()}?cluster=devnet`);

  // Generate PDAs
  const [switchPda] = PublicKey.findProgramAddressSync(
    [anchor.utils.bytes.utf8.encode("switch-test")], // 👈 make sure it matches on the prog side
    program.programId
  );
  console.log('switchPda:', switchPda.toBase58())
  const threadId = "thread-test-" + new Date().getTime() / 1000;
  console.log('threadId:', threadId)
  const [threadAuthority] = PublicKey.findProgramAddressSync(
    [anchor.utils.bytes.utf8.encode("authority-test")], // 👈 make sure it matches on the prog side
    program.programId
  );
  console.log('threadAuthority:', threadAuthority.toBase58())
  const [threadAddress, threadBump] = clockworkProvider.getThreadPDA(threadAuthority, threadId);
  console.log('threadAddress:', threadAddress.toBase58())

  // Fund the payer
  beforeEach(async () => {
    await connection.requestAirdrop(payer, LAMPORTS_PER_SOL * 100);
  });
  it("Initiates thread and switch", async () => {
    console.log(`payer ${payer}:, ${await connection.getBalance(payer)}`)
    try {
      // Generate and confirm initialize transaction 
      const signature = await program.methods
        .initialize(Buffer.from(threadId))
        .accounts({
          payer,
          systemProgram: SystemProgram.programId,
          clockworkProgram: clockworkProvider.threadProgram.programId,
          thread: threadAddress,
          threadAuthority: threadAuthority,
          switch: switchPda,
        })
        .rpc();
      assert.ok(signature);
      let { lastValidBlockHeight, blockhash } = await connection.getLatestBlockhash('finalized');
      const confirmation = await connection.confirmTransaction({ signature, lastValidBlockHeight, blockhash });
      assert.isNotOk(confirmation.value.err, "Transaction resulted in an error");

      // Check if thread and switch accounts were created
      const switchAccount = await program.account.switch.fetch(switchPda);
      assert.ok(switchAccount.switchState, "Switch state should be true");

      const threadAccount = await clockworkProvider.getThreadAccount(threadAddress);
      console.log("\nThread: ", threadAccount, "\n");

    } catch (error) {
      assert.fail(`An error occurred: ${error.message}`);
    }
  });

  it("Toggles switch 5 times", async () => {
    let slot = 0;
    for (let i = 0; i < 5; i++) {
      try {
        // Generate and confirm Toggle
        const signature = await program.methods
          .toggleSwitch()
          .accounts({
            switch: switchPda,
            payer,
          })
          .rpc();
        assert.ok(signature);
        let { lastValidBlockHeight, blockhash } = await connection.getLatestBlockhash('finalized');
        const confirmation = await connection.confirmTransaction({signature, lastValidBlockHeight, blockhash});
        assert.isNotOk(confirmation.value.err, "Transaction resulted in an error");
        
        // Wait for 2 second before checking the thread
        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log('await clockworkProvider.getThreadAccount(threadAddress):', await clockworkProvider.getThreadAccount(threadAddress));

        // Check if the thread triggered
        const execContext = (await clockworkProvider.getThreadAccount(threadAddress)).execContext;
        console.log('execContext:', execContext);
        if (execContext.lastExecAt) {
          console.log(`Loop ${i+1} Slot of last thread trigger: `, execContext.lastExecAt.toNumber());
          assert.ok(execContext.lastExecAt.toNumber() > slot, "Thread should have triggered");
          slot = execContext.lastExecAt.toNumber();  
        }

        // Wait for 2 second before next toggle
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        assert.fail(`An error occurred: ${error.message}`);
      }
    }
  });
});
