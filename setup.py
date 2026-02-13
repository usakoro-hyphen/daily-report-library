"""
写真文字読み取りアプリのpy2app設定ファイル
"""

from setuptools import setup

APP = ['ocr_app.py']
DATA_FILES = []
OPTIONS = {
    'argv_emulation': True,
    'iconfile': None,  # アイコンファイルがある場合はここに指定
    'plist': {
        'CFBundleName': '写真文字読み取りアプリ',
        'CFBundleDisplayName': '写真文字読み取りアプリ',
        'CFBundleGetInfoString': "写真から文字を読み取ってテキストファイルに保存するアプリケーション",
        'CFBundleIdentifier': "com.user.ocr-app",
        'CFBundleVersion': "1.0.0",
        'CFBundleShortVersionString': "1.0.0",
        'NSHumanReadableCopyright': "Copyright © 2025",
        'NSHighResolutionCapable': True,
    }
}

setup(
    app=APP,
    data_files=DATA_FILES,
    options={'py2app': OPTIONS},
    setup_requires=['py2app'],
    name='写真文字読み取りアプリ',
    version='1.0.0',
    description='写真から文字を読み取ってテキストファイルに保存するアプリケーション',
)