from setuptools import setup, find_packages

setup(
    name="betaflight-mcp-server",
    version="0.1.0",
    packages=find_packages(where="src"),
    package_dir={"": "src"},
    install_requires=[
        "mcp>=1.0.0",
        "pyserial>=3.5",
    ],
    entry_points={
        "console_scripts": [
            "betaflight-mcp=betaflight_mcp.server:main",
        ],
    },
    python_requires=">=3.9",
)
