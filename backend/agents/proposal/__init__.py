"""AI Proposal Builder (REL-413) — the first real REL-412 agent.

Lead → clarifying form (interrupt) → drafted proposal (menu + pricing + prose) on
the existing Quote. Built entirely on the REL-510 foundation; deterministic nodes
own all money and catalog decisions (LLM nodes propose, deterministic nodes dispose).
"""
from agents.proposal.runner import (ProposalRunError, regenerate_proposal,
                                     resume_proposal, start_proposal)

__all__ = ['start_proposal', 'resume_proposal', 'regenerate_proposal', 'ProposalRunError']
