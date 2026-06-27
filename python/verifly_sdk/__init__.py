"""Official Python SDK for the Verifly email-verification API (https://verifly.email).

PyPI package name: ``verifly-sdk``  (import as ``verifly_sdk``).

Quick start::

    from verifly_sdk import VeriflyClient

    client = VeriflyClient("vf_your_api_key")
    result = client.verify("bill.gates@microsoft.com")
    print(result["result"], result["recommendation"])
"""

from .client import VeriflyClient, VeriflyError, __version__

__all__ = ["VeriflyClient", "VeriflyError", "__version__"]
