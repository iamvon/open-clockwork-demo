use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::Instruction, native_token::LAMPORTS_PER_SOL, system_program,
};
use anchor_lang::InstructionData;
use clockwork_sdk::state::Thread;

declare_id!("46RcJ7gAKGvSpSfWPgX1GaEWurcscz2atDxho74aRDrq");

#[program]
pub mod open_clockwork_demo {
    use super::*;
    pub fn initialize(ctx: Context<Initialize>, thread_id: Vec<u8>) -> Result<()> {
        // 1 - Get accounts
        let switch = &mut ctx.accounts.switch;
        let payer = &ctx.accounts.payer;
        let system_program = &ctx.accounts.system_program;
        let clockwork_program = &ctx.accounts.clockwork_program;
        let thread: &SystemAccount = &ctx.accounts.thread;
        let thread_authority = &ctx.accounts.thread_authority;
        
        // 2 - Prepare an instruction to be automated
        let toggle_ix = Instruction {
            program_id: ID,
            accounts: crate::accounts::Response {
                thread: thread.key(),
                thread_authority: thread_authority.key(),
            }
            .to_account_metas(Some(true)),
            data: crate::instruction::Response {}.data(),
        };
    
        // 3a - Define an account trigger to execute on switch change
        let _account_trigger = clockwork_sdk::state::Trigger::Account {
            address: switch.key(),
            offset: 8, // offset of the switch state (the discriminator is 8 bytes)
            size: 1,   // size of the switch state (1 byte)
        };
        // 3b - Define a cron trigger for the thread (every 1 sec)
        let cron_trigger = clockwork_sdk::state::Trigger::Cron {
            schedule: "*/1 * * * * * *".into(),
            skippable: true,
        };
    
        // 4 - Create thread via CPI
        let bump = ctx.bumps.thread_authority;
        clockwork_sdk::cpi::thread_create(
            CpiContext::new_with_signer(
                clockwork_program.to_account_info(),
                clockwork_sdk::cpi::ThreadCreate {
                    payer: payer.to_account_info(),
                    system_program: system_program.to_account_info(),
                    thread: thread.to_account_info(),
                    authority: thread_authority.to_account_info(),
                },
                &[&[THREAD_AUTHORITY_SEED, &[bump]]],
            ),
            LAMPORTS_PER_SOL/100 as u64,    // amount
            thread_id,                      // id
            vec![toggle_ix.into()],         // instructions
            cron_trigger,                // trigger
        )?;

        // 5 - Initialize switch
        switch.switch_state = true;
    
        Ok(())
    }
    pub fn toggle_switch(ctx: Context<ToggleSwitch>) -> Result<()> {
        let switch = &mut ctx.accounts.switch;
        switch.switch_state = !switch.switch_state;
        Ok(())
    }
    pub fn response(_ctx: Context<Response>) -> Result<()> {
        msg!("Response to trigger at {}", Clock::get().unwrap().unix_timestamp);
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(thread_id: Vec<u8>)]
pub struct Initialize<'info> {
    #[account(
        init_if_needed,
        payer = payer,
        seeds = [SWITCH_SEED],
        bump,
        space = 8 + 1 // 8 bytes for discriminator, 1 byte for bool
    )]
    pub switch: Account<'info, Switch>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(address = system_program::ID)]
    pub system_program: Program<'info, System>,

    #[account(address = clockwork_sdk::ID)]
    pub clockwork_program: Program<'info, clockwork_sdk::ThreadProgram>,

    #[account(mut, address = Thread::pubkey(thread_authority.key(), thread_id))]
    pub thread: SystemAccount<'info>,

    #[account(seeds = [THREAD_AUTHORITY_SEED], bump)]
    pub thread_authority: SystemAccount<'info>,
}
#[derive(Accounts)]
pub struct ToggleSwitch<'info> {
    #[account(mut, seeds = [SWITCH_SEED], bump)]
    pub switch: Account<'info, Switch>,

    #[account(mut)]
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
pub struct Response<'info> {
    #[account(signer, constraint = thread.authority.eq(&thread_authority.key()))]
    pub thread: Account<'info, Thread>,

    #[account(seeds = [THREAD_AUTHORITY_SEED], bump)]
    pub thread_authority: SystemAccount<'info>,    
}

#[account]
pub struct Switch {
    pub switch_state: bool,
}

pub const SWITCH_SEED: &[u8] = b"switch-test";

pub const THREAD_AUTHORITY_SEED: &[u8] = b"authority-test";
